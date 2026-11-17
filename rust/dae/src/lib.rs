//! Builds the vertex data of a COLLADA file's <library_geometries> the way three's ColladaLoader does,
//! and returns the file with those numbers removed, so ColladaLoader only parses materials and the scene.
//! Anything outside the handled subset returns an error and the caller falls back to ColladaLoader alone.

use std::collections::HashMap;

pub struct Output {
    pub xml: Vec<u8>,
    pub json: String,
    pub floats: Vec<f32>,
}

struct Element<'a> {
    name: &'a [u8],
    attrs: &'a [u8],
    children: Vec<usize>,
    text: (usize, usize),
}

const MALFORMED: i32 = 1;
const UNSUPPORTED: i32 = 2;

fn is_ws(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r')
}

fn find(b: &[u8], from: usize, pat: &[u8]) -> Result<usize, i32> {
    b[from..].windows(pat.len()).position(|w| w == pat).map(|p| p + from).ok_or(MALFORMED)
}

fn parse_xml(b: &[u8]) -> Result<Vec<Element<'_>>, i32> {
    let mut els = vec![Element { name: b"", attrs: b"", children: vec![], text: (0, 0) }];
    let mut stack = vec![0usize];
    let mut pending: Option<usize> = None;
    let mut i = 0;
    while let Some(off) = b[i..].iter().position(|&c| c == b'<') {
        let lt = i + off;
        if let Some(start) = pending.take() {
            let top = *stack.last().unwrap();
            els[top].text = (start, lt);
        }
        let rest = &b[lt..];
        if rest.starts_with(b"<?") {
            i = find(b, lt, b"?>")? + 2;
        } else if rest.starts_with(b"<!--") {
            i = find(b, lt, b"-->")? + 3;
        } else if rest.starts_with(b"<![CDATA[") {
            return Err(UNSUPPORTED);
        } else if rest.starts_with(b"<!") {
            i = find(b, lt, b">")? + 1;
        } else if rest.starts_with(b"</") {
            i = find(b, lt, b">")? + 1;
            stack.pop();
            if stack.is_empty() {
                return Err(MALFORMED);
            }
        } else {
            let mut j = lt + 1;
            while j < b.len() && !is_ws(b[j]) && b[j] != b'>' && b[j] != b'/' {
                j += 1;
            }
            let mut k = j;
            let mut quote = 0u8;
            while k < b.len() {
                let c = b[k];
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'>' {
                    break;
                }
                k += 1;
            }
            if k >= b.len() {
                return Err(MALFORMED);
            }
            let self_closing = b[k - 1] == b'/';
            let idx = els.len();
            els.push(Element {
                name: &b[lt + 1..j],
                attrs: &b[j..if self_closing { k - 1 } else { k }],
                children: vec![],
                text: (k + 1, k + 1),
            });
            let top = *stack.last().unwrap();
            els[top].children.push(idx);
            if !self_closing {
                stack.push(idx);
                pending = Some(k + 1);
            }
            i = k + 1;
        }
    }
    Ok(els)
}

fn attr<'a>(a: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut i = 0;
    while i < a.len() {
        while i < a.len() && is_ws(a[i]) {
            i += 1;
        }
        let start = i;
        while i < a.len() && a[i] != b'=' && !is_ws(a[i]) {
            i += 1;
        }
        let name = &a[start..i];
        while i < a.len() && (is_ws(a[i]) || a[i] == b'=') {
            i += 1;
        }
        if i >= a.len() {
            break;
        }
        let quote = a[i];
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let value_start = i + 1;
        let value_end = value_start + a[value_start..].iter().position(|&c| c == quote)?;
        if name == key {
            return Some(&a[value_start..value_end]);
        }
        i = value_end + 1;
    }
    None
}

fn tokens(b: &[u8]) -> impl Iterator<Item = &[u8]> {
    b.split(|&c| is_ws(c)).filter(|t| !t.is_empty())
}

// Through f64 like JS parseFloat, then f32 like Float32BufferAttribute.
fn floats(b: &[u8]) -> Result<Vec<f32>, i32> {
    tokens(b)
        .map(|t| std::str::from_utf8(t).ok().and_then(|s| s.parse::<f64>().ok()).map(|v| v as f32).ok_or(UNSUPPORTED))
        .collect()
}

fn ints(b: &[u8]) -> Result<Vec<u32>, i32> {
    tokens(b)
        .map(|t| {
            if t.is_empty() || t.len() > 9 || !t.iter().all(u8::is_ascii_digit) {
                return Err(UNSUPPORTED);
            }
            Ok(t.iter().fold(0u32, |n, &c| n * 10 + (c - b'0') as u32))
        })
        .collect()
}

fn int_attr(a: &[u8], key: &[u8]) -> Option<usize> {
    std::str::from_utf8(attr(a, key)?).ok()?.trim().parse().ok()
}

fn id_ref(url: &[u8]) -> &[u8] {
    url.strip_prefix(b"#").unwrap_or(url)
}

fn descendants(els: &[Element], idx: usize, name: &[u8], out: &mut Vec<usize>) {
    for &c in &els[idx].children {
        if els[c].name == name {
            out.push(c);
        }
        descendants(els, c, name, out);
    }
}

fn first_descendant(els: &[Element], idx: usize, name: &[u8]) -> Option<usize> {
    let mut out = vec![];
    descendants(els, idx, name, &mut out);
    out.first().copied()
}

struct Source {
    array: Vec<f32>,
    stride: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Attr {
    Position,
    Normal,
    Uv,
}

const ATTR_NAMES: [&str; 3] = ["position", "normal", "uv"];

struct Primitive<'a> {
    kind: &'a [u8],
    count: usize,
    inputs: Vec<(Vec<u8>, &'a [u8], usize)>,
    stride: usize,
    p: Vec<u32>,
    vcount: Option<Vec<u32>>,
}

fn attr_of(semantic: &[u8]) -> Result<Option<Attr>, i32> {
    Ok(match semantic {
        b"POSITION" => Some(Attr::Position),
        b"NORMAL" => Some(Attr::Normal),
        b"TEXCOORD" => Some(Attr::Uv),
        b"COLOR" | b"TEXCOORD1" => return Err(UNSUPPORTED),
        _ => None,
    })
}

// ColladaLoader's pushVector over one primitive.
fn push_source(prim: &Primitive, source: &Source, offset: usize, out: &mut Vec<f32>) -> Result<(), i32> {
    let stride = prim.stride;
    let s = source.stride;
    let mut push = |i: usize| -> Result<(), i32> {
        let index = *prim.p.get(i + offset).ok_or(UNSUPPORTED)? as usize * s;
        let values = source.array.get(index..index + s).ok_or(UNSUPPORTED)?;
        out.extend_from_slice(values);
        Ok(())
    };
    match &prim.vcount {
        Some(vcount) => {
            let mut index = 0;
            for &count in vcount {
                let count = count as usize;
                if count == 4 {
                    for k in [0, 1, 3, 1, 2, 3] {
                        push(index + stride * k)?;
                    }
                } else if count == 3 {
                    for k in [0, 1, 2] {
                        push(index + stride * k)?;
                    }
                } else if count > 4 {
                    for k in 1..count - 1 {
                        for v in [0, k, k + 1] {
                            push(index + stride * v)?;
                        }
                    }
                }
                index += stride * count;
            }
        }
        None => {
            let mut i = 0;
            while i < prim.p.len() {
                push(i)?;
                i += stride;
            }
        }
    }
    Ok(())
}

fn group_count(prim: &Primitive) -> Result<usize, i32> {
    Ok(match prim.kind {
        b"lines" | b"linestrips" => prim.count * 2,
        b"triangles" => prim.count * 3,
        _ => {
            let vcount = prim.vcount.as_ref().ok_or(UNSUPPORTED)?;
            let mut n = 0usize;
            for g in 0..prim.count {
                n += match *vcount.get(g).ok_or(UNSUPPORTED)? {
                    3 => 3,
                    4 => 6,
                    vc if vc > 4 => (vc as usize - 2) * 3,
                    _ => return Err(UNSUPPORTED),
                };
            }
            n
        }
    })
}

fn json_str(s: &[u8]) -> Result<String, i32> {
    let s = std::str::from_utf8(s).map_err(|_| UNSUPPORTED)?;
    // ColladaLoader keys by the decoded attribute; entities would not match the raw bytes.
    if s.contains('&') {
        return Err(UNSUPPORTED);
    }
    Ok(format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")))
}

pub fn convert(b: &[u8]) -> Result<Output, i32> {
    let els = parse_xml(b)?;
    if els.iter().any(|e| e.name == b"instance_controller") {
        return Err(UNSUPPORTED);
    }
    let mut strip: Vec<(usize, usize)> = vec![];
    let mut floats_out: Vec<f32> = vec![];
    let mut json = String::from("[");
    let mut geometries = vec![];
    if let Some(library) = first_descendant(&els, 0, b"library_geometries") {
        descendants(&els, library, b"geometry", &mut geometries);
    }
    for (gi, &g) in geometries.iter().enumerate() {
        let id = attr(els[g].attrs, b"id").ok_or(UNSUPPORTED)?;
        let Some(mesh) = first_descendant(&els, g, b"mesh") else { continue };
        let mut sources: HashMap<&[u8], Source> = HashMap::new();
        let mut vertices: Vec<(&[u8], &[u8])> = vec![];
        let mut primitives: Vec<Primitive> = vec![];
        for &c in &els[mesh].children {
            let e = &els[c];
            match e.name {
                b"source" => {
                    let mut source = Source { array: vec![], stride: 3 };
                    for &sc in &e.children {
                        match els[sc].name {
                            b"float_array" => {
                                let (s, t) = els[sc].text;
                                source.array = floats(&b[s..t])?;
                                strip.push((s, t));
                            }
                            b"technique_common" => {
                                if let Some(acc) = first_descendant(&els, sc, b"accessor") {
                                    source.stride = int_attr(els[acc].attrs, b"stride").ok_or(UNSUPPORTED)?;
                                }
                            }
                            _ => {}
                        }
                    }
                    sources.insert(attr(e.attrs, b"id").unwrap_or(b""), source);
                }
                b"vertices" => {
                    vertices.clear();
                    for &ic in &e.children {
                        let a = els[ic].attrs;
                        vertices.push((attr(a, b"semantic").ok_or(UNSUPPORTED)?, id_ref(attr(a, b"source").ok_or(UNSUPPORTED)?)));
                    }
                }
                b"triangles" | b"polylist" | b"lines" | b"linestrips" => {
                    let mut prim = Primitive {
                        kind: e.name,
                        count: int_attr(e.attrs, b"count").ok_or(UNSUPPORTED)?,
                        inputs: vec![],
                        stride: 0,
                        p: vec![],
                        vcount: None,
                    };
                    for &pc in &e.children {
                        let pe = &els[pc];
                        match pe.name {
                            b"input" => {
                                let semantic = attr(pe.attrs, b"semantic").ok_or(UNSUPPORTED)?;
                                let offset = int_attr(pe.attrs, b"offset").ok_or(UNSUPPORTED)?;
                                let mut name = semantic.to_vec();
                                if let Some(set) = int_attr(pe.attrs, b"set").filter(|&s| s > 0) {
                                    name.extend_from_slice(set.to_string().as_bytes());
                                }
                                let source = id_ref(attr(pe.attrs, b"source").ok_or(UNSUPPORTED)?);
                                prim.inputs.retain(|(n, _, _)| *n != name);
                                prim.inputs.push((name, source, offset));
                                prim.stride = prim.stride.max(offset + 1);
                            }
                            b"vcount" => {
                                let (s, t) = pe.text;
                                prim.vcount = Some(ints(&b[s..t])?);
                                strip.push((s, t));
                            }
                            b"p" => {
                                let (s, t) = pe.text;
                                prim.p = ints(&b[s..t])?;
                                strip.push((s, t));
                            }
                            _ => {}
                        }
                    }
                    primitives.push(prim);
                }
                _ => {}
            }
        }
        if gi > 0 && json.len() > 1 {
            json.push(',');
        }
        json.push_str(&format!("{{\"id\":{},\"types\":[", json_str(id)?));
        let mut kinds: Vec<&[u8]> = vec![];
        for prim in &primitives {
            if !kinds.contains(&prim.kind) {
                kinds.push(prim.kind);
            }
        }
        for (ki, kind) in kinds.iter().enumerate() {
            let prims: Vec<&Primitive> = primitives.iter().filter(|p| p.kind == *kind).collect();
            let with_uv = prims.iter().filter(|p| p.inputs.iter().any(|(n, _, _)| n.starts_with(b"TEXCOORD"))).count();
            if with_uv != 0 && with_uv != prims.len() {
                return Err(UNSUPPORTED);
            }
            let mut arrays: [Vec<f32>; 3] = [vec![], vec![], vec![]];
            let mut strides = [0usize; 3];
            let mut layout: Option<Vec<Attr>> = None;
            let mut groups = String::new();
            let mut start = 0;
            for (pi, prim) in prims.iter().enumerate() {
                let count = group_count(prim)?;
                groups.push_str(&format!("{}[{},{}]", if pi > 0 { "," } else { "" }, start, count));
                start += count;
                let mut used: Vec<Attr> = vec![];
                let mut feed = |a: Attr, src: &[u8], offset: usize| -> Result<(), i32> {
                    if used.contains(&a) {
                        return Err(UNSUPPORTED);
                    }
                    used.push(a);
                    let source = sources.get(src).ok_or(UNSUPPORTED)?;
                    if strides[a as usize] != 0 && strides[a as usize] != source.stride {
                        return Err(UNSUPPORTED);
                    }
                    strides[a as usize] = source.stride;
                    push_source(prim, source, offset, &mut arrays[a as usize])
                };
                for (name, src, offset) in &prim.inputs {
                    if name == b"VERTEX" {
                        for (semantic, vsrc) in &vertices {
                            if let Some(a) = attr_of(semantic)? {
                                feed(a, vsrc, *offset)?;
                            }
                        }
                    } else if let Some(a) = attr_of(name)? {
                        if a == Attr::Position {
                            continue;
                        }
                        feed(a, src, *offset)?;
                    }
                }
                used.sort_by_key(|a| *a as usize);
                match &layout {
                    None => layout = Some(used),
                    Some(l) if *l != used => return Err(UNSUPPORTED),
                    _ => {}
                }
            }
            let mut attrs = String::new();
            for (a, array) in arrays.iter().enumerate() {
                if array.is_empty() {
                    continue;
                }
                attrs.push_str(&format!(
                    "{}[\"{}\",{},{},{}]",
                    if attrs.is_empty() { "" } else { "," },
                    ATTR_NAMES[a],
                    floats_out.len(),
                    array.len(),
                    strides[a]
                ));
                floats_out.extend_from_slice(array);
            }
            json.push_str(&format!(
                "{}{{\"type\":\"{}\",\"groups\":[{}],\"attributes\":[{}]}}",
                if ki > 0 { "," } else { "" },
                std::str::from_utf8(kind).unwrap(),
                groups,
                attrs
            ));
        }
        json.push_str("]}");
    }
    json.push(']');
    strip.sort_unstable();
    let mut xml = Vec::with_capacity(b.len() / 8);
    let mut at = 0;
    for (s, t) in strip {
        xml.extend_from_slice(&b[at..s]);
        at = t;
    }
    xml.extend_from_slice(&b[at..]);
    Ok(Output { xml, json, floats: floats_out })
}

static mut INPUT: Vec<u8> = Vec::new();
static mut OUTPUT: Option<Output> = None;
static mut RESULT: [u32; 7] = [0; 7];

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    unsafe {
        let input = &mut *std::ptr::addr_of_mut!(INPUT);
        *input = vec![0; len];
        input.as_mut_ptr()
    }
}

/// [status, xml ptr, xml len, json ptr, json len, f32 ptr, f32 count]; status 0 is success.
#[no_mangle]
pub extern "C" fn run() -> *const u32 {
    unsafe {
        let result = &mut *std::ptr::addr_of_mut!(RESULT);
        let output = &mut *std::ptr::addr_of_mut!(OUTPUT);
        match convert(&*std::ptr::addr_of!(INPUT)) {
            Ok(out) => {
                *output = Some(out);
                let o = output.as_ref().unwrap();
                *result = [
                    0,
                    o.xml.as_ptr() as u32,
                    o.xml.len() as u32,
                    o.json.as_ptr() as u32,
                    o.json.len() as u32,
                    o.floats.as_ptr() as u32,
                    o.floats.len() as u32,
                ];
            }
            Err(code) => result[0] = code as u32,
        }
        result.as_ptr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dae(input: &str, primitive: &str) -> String {
        format!(r##"<?xml version="1.0"?><COLLADA><library_geometries><geometry id="g"><mesh>
<source id="p"><float_array id="pa" count="12">0 0 0 1 0 0 1 1 0 0 1 0</float_array><technique_common><accessor source="#pa" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
{input}{primitive}</mesh></geometry></library_geometries></COLLADA>"##)
    }

    #[test]
    fn triangles_become_floats_and_leave_the_xml() {
        let out = convert(dae("", r##"<triangles count="2"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2 0 2 3</p></triangles>"##).as_bytes()).ok().unwrap();
        // Non-indexed, as ColladaLoader builds it: one position per corner.
        assert_eq!(out.floats, [0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 0., 0., 1., 1., 0., 0., 1., 0.]);
        assert_eq!(out.json, r#"[{"id":"g","types":[{"type":"triangles","groups":[[0,6]],"attributes":[["position",0,18,3]]}]}]"#);
        let xml = String::from_utf8(out.xml).unwrap();
        assert!(!xml.contains("1 1 0") && !xml.contains("0 2 3"), "numbers stay in the XML: {xml}");
        assert!(xml.contains(r#"<geometry id="g">"#));
    }

    #[test]
    fn a_quad_polylist_splits_like_colladaloader() {
        let out = convert(dae("", r##"<polylist count="1"><input semantic="VERTEX" source="#v" offset="0"/><vcount>4</vcount><p>0 1 2 3</p></polylist>"##).as_bytes()).ok().unwrap();
        // (a, b, d) and (b, c, d), ColladaLoader's split of a quad.
        assert_eq!(out.floats, [0., 0., 0., 1., 0., 0., 0., 1., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0.]);
    }

    #[test]
    fn vertex_colors_and_broken_xml_are_left_to_colladaloader() {
        let colors = dae(r##"<source id="c"><float_array id="ca" count="3">1 0 0</float_array><technique_common><accessor source="#ca" count="1" stride="3"/></technique_common></source>"##,
            r##"<triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><input semantic="COLOR" source="#c" offset="0"/><p>0 1 2</p></triangles>"##);
        assert_eq!(convert(colors.as_bytes()).err(), Some(UNSUPPORTED));
        assert!(convert(b"<COLLADA><library_geometries><geometry").is_err());
    }
}
