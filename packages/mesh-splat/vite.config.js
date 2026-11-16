import { defineConfig } from 'vite';

// Embind builds its call wrappers with `new Function`, which the webview CSP (no 'unsafe-eval') blocks.
// These closures do the same calls; the build fails if a rebuilt vendor/occt changes the code they replace.
const EMBIND_PATCHES = [
    [
        'let[args,invokerFnBody]=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);args.push(invokerFnBody);var invokerFn=newFunc(Function,args)(...closureArgs);',
        'var invokerFn=function(...a){var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];if(isClassMethodFunc)wired.push(argTypes[1].toWireType(destructors,this));for(var i=0;i<argCount-2;++i)wired.push(argTypes[i+2].toWireType(destructors,a[i]));var rv=cppInvokerFunc(...wired);if(needsDestructorStack)runDestructors(destructors);else for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i)if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(wired[isClassMethodFunc?i:i-1]);if(returns)return argTypes[0].fromWireType(rv)};'
    ],
    [
        'params.push(functionBody);var invokerFunction=newFunc(Function,params)(...args);',
        'var invokerFunction=(obj,func,destructorsRef,argsPtr)=>{var list=kind===0?[obj]:[];for(var i=0,offset=0;i<argCount;++i){list.push(types[i].readValueFromPointer(argsPtr+offset));offset+=types[i].argPackAdvance}var rv=kind===1?new func(...list):func.call(...list);if(!retType.isVoid)return emval_returnValue(retType,destructorsRef,rv)};'
    ]
];

const occtWithoutEval = {
    name: 'occt-without-eval',
    enforce: 'pre',
    transform(code, id) {
        if (!id.endsWith('vendor/occt/occt-import-js.js')) return;
        for (const [from, to] of EMBIND_PATCHES) {
            if (!code.includes(from)) throw new Error(`vendor/occt changed, embind patch no longer applies: ${from.slice(0, 60)}`);
            code = code.replace(from, to);
        }
        if (/newFunc\(Function/.test(code)) throw new Error('occt-import-js still builds functions from strings');
        return code;
    }
};

export default defineConfig({
    root: 'webview',
    base: './',
    plugins: [occtWithoutEval],
    worker: { plugins: () => [occtWithoutEval] },
    build: {
        // The emscripten glue in vendor/occt is CommonJS.
        commonjsOptions: { include: [/node_modules/, /vendor\/occt/] },
        outDir: '../dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 5000,
        rollupOptions: { output: { entryFileNames: 'main.js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' } }
    }
});
