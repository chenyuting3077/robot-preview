// Installs linkedom as the webview's DOMParser and XMLSerializer for the tests that import this file.
import { DOMParser, Document, Element } from 'linkedom';

globalThis.DOMParser ??= DOMParser;
globalThis.Document ??= Document;
globalThis.Element ??= Element;
globalThis.XMLSerializer ??= class {
    serializeToString(node) {
        return node.toString();
    }
};

// linkedom's XML getAttribute returns ">" as "&gt;"; a browser's, which xacro-parser reads, returns ">".
let proto = new DOMParser().parseFromString('<a/>', 'text/xml').documentElement;
while (!Object.hasOwn(proto, 'getAttribute')) proto = Object.getPrototypeOf(proto);
proto.getAttribute = function (name) {
    return this.getAttributeNode(name)?.value ?? null;
};
