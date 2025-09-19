import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { VFS, Bootloader } from '../types';

// FIX: Declare Babel to resolve 'Cannot find name' error from using the global Babel object.
declare var Babel: any;

// Make the genAI module available to the LivePreview iframe's parent window
// to solve the dependency injection problem in the sandboxed environment.
useEffect(() => {
    import('@google/genai').then(mod => {
        (window as any).GoogleGenAIModule = mod;
    });
}, []);


// =============================================================================
// LIVE PREVIEW COMPONENT
// Transpiles and runs the application from the VFS in a sandboxed iframe.
// =============================================================================

const LivePreview: React.FC<{ vfs: VFS }> = ({ vfs }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bundleAndRun = () => {
      try {
        setError(null);
        const transpiledVFS: { [key: string]: string } = {};

        // Transpile all TS/TSX files
        for (const path in vfs) {
          if (path.endsWith('.ts') || path.endsWith('.tsx')) {
            transpiledVFS[path] = Babel.transform(vfs[path], {
              presets: ['react', 'typescript'],
              plugins: ['transform-modules-commonjs'],
              filename: path,
            }).code;
          }
        }

        const entryPoint = '/index.tsx';
        if (!transpiledVFS[entryPoint]) {
          throw new Error('Entry point /index.tsx not found in VFS.');
        }

        // Create a self-executing bundle string
        const bundle = `
          (function() {
            const modules = {};
            const moduleCache = {};

            const process = { env: { API_KEY: '${process.env.API_KEY}' } };
            
            // Load external libraries from the parent window where they are available
            const ParentReact = window.parent.React;
            const ParentGoogleGenAIModule = window.parent.GoogleGenAIModule;

            function executeModule(path, code) {
              const require = (relativePath) => {
                // Check for external dependencies first
                if (relativePath === 'react') return ParentReact;
                if (relativePath === '@google/genai') return ParentGoogleGenAIModule;

                const absolutePath = resolvePath(path, relativePath);
                if (!modules[absolutePath]) {
                  throw new Error(\`Module not found: \${absolutePath} from \${path}\`);
                }
                if (moduleCache[absolutePath]) {
                  return moduleCache[absolutePath].exports;
                }
                const module = { exports: {} };
                moduleCache[absolutePath] = module;
                executeModule(absolutePath, modules[absolutePath]);
                return module.exports;
              };
              
              const module = moduleCache[path];
              new Function('require', 'module', 'exports', 'process', code)(require, module, module.exports, process);
            }
            
            function resolvePath(base, relative) {
                if (!relative.startsWith('.')) return relative;
                const stack = base.split('/').slice(0, -1);
                const parts = relative.split('/');
                for (const part of parts) {
                    if (part === '..') stack.pop();
                    else if (part !== '.') stack.push(part);
                }
                let path = stack.join('/');
                if (!path.endsWith('.tsx') && !path.endsWith('.ts')) {
                    if (modules[path + '.tsx']) path += '.tsx';
                    else if (modules[path + '.ts']) path += '.ts';
                }
                return path;
            }

            // Populate modules
            ${Object.entries(transpiledVFS).map(([path, code]) => `modules['${path}'] = ${JSON.stringify(code)};`).join('\n')}
            
            // Execute entry point
            const entryModule = { exports: {} };
            moduleCache['${entryPoint}'] = entryModule;
            executeModule('${entryPoint}', modules['${entryPoint}']);
          })();
        `;
        
        const iframe = iframeRef.current;
        if (!iframe) return;

        const doc = iframe.contentDocument;
        if (doc) {
          const htmlContent = vfs['/index.html'] || '<body></body>';
          // Clear previous script and add the new one
          const finalHtml = htmlContent.replace(/<script.*<\/script>/g, '').replace('</body>', `<script>${bundle}</script></body>`);
          doc.open();
          doc.write(finalHtml);
          doc.close();
        }
      } catch (err) {
        console.error("Live Preview Error:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    bundleAndRun();
  }, [vfs]);

  return (
    <div className="w-full h-full bg-white relative">
      {error && (
        <div className="absolute inset-0 bg-red-100 text-red-800 p-4 z-10 overflow-auto">
          <h3 className="font-bold mb-2">Execution Error:</h3>
          <pre className="text-sm whitespace-pre-wrap">{error}</pre>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Live Preview"
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
};


// =============================================================================
// KERNEL COMPONENT (THE IDE)
// =============================================================================

const Kernel: React.FC<Bootloader> = ({ vfs, onVfsUpdate, onVfsBatchUpdate }) => {
  const [activeFile, setActiveFile] = useState('/App.tsx');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSummary, setLastSummary] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  
  const handleEvolve = async () => {
    if (!prompt) {
      setError("Please enter a prompt to describe the change.");
      return;
    }
    setIsLoading(true);
    setError('');
    setLastSummary('Thinking...');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const allFilePaths = Object.keys(vfs).join('\n');
      const activeFileContent = vfs[activeFile] || '';
      
      const metaPrompt = `
You are an expert AI programmer building a self-evolving application. Your task is to modify the application's source code based on a user's request.
You have access to the application's virtual file system (VFS).

Analyze the user's prompt, the list of all files, and the content of the currently active file.
Determine which file(s) need to be modified. You can modify one or more files.
Return a JSON object containing your plan and the full updated content for each file you want to change.

USER PROMPT:
---
${prompt}
---

ALL FILE PATHS IN VFS:
---
${allFilePaths}
---

ACTIVE FILE CONTENT for ${activeFile}:
---
${activeFileContent}
---

Respond with a JSON object that matches this schema. Your response MUST be only the JSON object, without any markdown formatting.
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: metaPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              thought: { 
                type: Type.STRING,
                description: "A brief step-by-step plan of what you will do."
              },
              summary: { 
                type: Type.STRING,
                description: "A concise summary of the changes you made, to be shown to the user."
               },
              changes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filePath: { type: Type.STRING },
                    content: { type: Type.STRING }
                  },
                  required: ["filePath", "content"]
                }
              }
            },
            required: ["thought", "summary", "changes"]
          }
        }
      });
      
      const result = JSON.parse(response.text);

      if (result.changes && result.changes.length > 0) {
        onVfsBatchUpdate(result.changes);
        setLastSummary(result.summary || 'Evolution complete!');
        // If the AI modified the active file, move selection to the first modified file
        const modifiedPaths = result.changes.map((c: any) => c.filePath);
        if (!modifiedPaths.includes(activeFile)) {
            setActiveFile(modifiedPaths[0]);
        }
      } else {
        setLastSummary("No changes were made. I might need a more specific prompt.");
      }
      setPrompt('');

    } catch (err) {
      console.error("Evolution Error:", err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      setLastSummary('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Tab' && e.target === editorRef.current) {
            e.preventDefault();
            const target = e.target as HTMLTextAreaElement;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            target.setRangeText('  ', start, end, 'end');
        }
    };
    const editor = editorRef.current;
    editor?.addEventListener('keydown', handleKeyDown);
    return () => editor?.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <aside className="w-64 bg-gray-800 p-4 border-r border-gray-700 overflow-y-auto">
        <h2 className="text-lg font-bold mb-4 text-gray-300">File System</h2>
        {Object.keys(vfs).sort().map(path => (
          <div
            key={path}
            onClick={() => setActiveFile(path)}
            className={`text-sm p-2 rounded cursor-pointer truncate ${activeFile === path ? 'bg-indigo-600 text-white font-semibold' : 'hover:bg-gray-700'}`}
          >
            {path}
          </div>
        ))}
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="p-4 bg-gray-800 border-b border-gray-700">
          <h2 className="text-lg font-bold mb-2 text-gray-300">Evolution Control</h2>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`Describe a change for the application...`}
            className="w-full p-2 bg-gray-900 rounded border border-gray-700 h-28 code-editor focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            aria-label="AI Prompt"
          />
          <div className="flex justify-between items-center mt-2">
            <button
              onClick={handleEvolve}
              disabled={isLoading}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-500"
            >
              {isLoading && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
              {isLoading ? 'Evolving...' : 'Evolve'}
            </button>
             <div className="text-right">
                {lastSummary && !isLoading && <p className="text-sm text-gray-400">{lastSummary}</p>}
                {isLoading && <p className="text-sm text-indigo-400">{lastSummary}</p>}
                {error && <div className="text-red-500 text-sm font-semibold">{error}</div>}
             </div>
          </div>
        </div>

        <div className="flex-grow flex h-0">
          <div className="w-1/2 flex flex-col p-4">
             <h3 className="font-bold mb-2 text-gray-400">{activeFile}</h3>
             <textarea
               ref={editorRef}
               value={vfs[activeFile] || ''}
               onChange={e => onVfsUpdate(activeFile, e.target.value)}
               className="flex-grow w-full bg-gray-900 text-gray-100 p-4 rounded border border-gray-700 code-editor focus:ring-2 focus:ring-indigo-500 focus:outline-none"
               spellCheck="false"
               aria-label="Code Editor"
             />
          </div>
          <div className="w-1/2 flex flex-col p-4 border-l border-gray-700">
             <h3 className="font-bold mb-2 text-gray-400">Live Preview</h3>
             <div className="flex-grow bg-white rounded overflow-hidden">
                <LivePreview vfs={vfs} />
             </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Kernel;
