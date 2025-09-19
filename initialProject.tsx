export const INITIAL_PROJECT: Record<string, string> = {
  '/boot/bootloader.tsx': `
import { GoogleGenAI, Type } from "@google/genai";

// AI Service logic is now merged directly into the bootloader
// to solve a bootstrapping dependency issue with the static BIOS.

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  // In a real app, you might want a more graceful fallback.
  // Here we throw an error to be caught by the BIOS.
  throw new Error("API_KEY environment variable not set. This is a fatal error for the OS.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface Evolution {
  action: 'UPDATE' | 'CREATE' | 'DELETE';
  filePath: string;
  code: string;
}

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        action: { type: Type.STRING, enum: ['UPDATE', 'CREATE', 'DELETE'] },
        filePath: { type: Type.STRING },
        code: { type: Type.STRING }
    },
    required: ['action', 'filePath'] // code is not required for DELETE
};

export const evolveCode = async (
    targetFilePath, 
    goal, 
    projectFiles
) => {
  const fileTree = Object.keys(projectFiles).join('\\n');
  const currentCode = projectFiles[targetFilePath] || '';
  const prompt = \`
    You are an expert AI developer architecting a self-evolving React application.
    Your task is to achieve the user's GOAL by intelligently modifying the project's file system.
    The application has a BIOS, an OS, and a Kernel. You are modifying the OS and Kernel.

    CRITICAL SYSTEM FILES:
    - /boot/bootloader.tsx: The dynamic "Operating System". It transpiles and runs the kernel. IT ALSO CONTAINS YOUR OWN SOURCE CODE (this evolveCode function). Modifying this is powerful but risky.
    - /boot/kernel.tsx: The main "IDE" application UI. This is the primary user-facing part of the app.

    You have three actions available: UPDATE, CREATE, or DELETE a single file.

    CRITICAL INSTRUCTIONS:
    1.  Your response MUST be a single, valid JSON object matching the required schema. DO NOT include markdown.
    2.  Analyze the user's GOAL and the PROJECT FILE TREE to decide the best action.
    3.  For UPDATE or CREATE, the 'code' property must be the complete, raw source code for the file.
    4.  For DELETE, you can omit the 'code' property.
    5.  You can operate on any file to achieve the goal, not just the currently active one.
    6.  Use 'React' for hooks (e.g., \\\\\`React.useState\\\\\`). Do not add \\\\\`import React from 'react'\\\\\`. The 'React' global is provided.
    7.  Ensure all file paths start with '/'.

    PROJECT FILE TREE:
    ---
    \${fileTree}
    ---
    USER'S GOAL (in context of '\${targetFilePath}'): \${goal}
    ---
    CURRENT CODE OF '\${targetFilePath}':
    ---
    \${currentCode}
    ---
  \`;

  const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.1,
        topP: 0.9,
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
      }
  });

  const jsonText = response.text;
  if (!jsonText) throw new Error("Received an empty response from the AI.");
  
  const evolution = JSON.parse(jsonText);
  if (evolution.action === 'DELETE') evolution.code = '';
  return evolution;
};


// This is the dynamic "Operating System" of the application.
// It is loaded by the static BIOS (App.tsx).
// Its job is to manage the project state, compile and run the Kernel,
// and handle the evolution process.
function Bootloader({ initialFiles, onSaveFiles, onFactoryReset }) {
  const [projectFiles, setProjectFiles] = React.useState(initialFiles);
  const [KernelComponent, setKernelComponent] = React.useState(null);
  const [isEvolving, setIsEvolving] = React.useState(false);
  const [bootError, setBootError] = React.useState(null);
  
  // Persist project files whenever they change
  React.useEffect(() => {
    onSaveFiles(projectFiles);
  }, [projectFiles, onSaveFiles]);

  const runProject = React.useCallback(() => {
    console.log("OS: Booting kernel...");
    setBootError(null);

    // This timeout allows the UI to update before the potentially blocking transpile/exec work
    setTimeout(() => {
        const moduleCache = {};

        const customRequire = (importerPath, importPath) => {
            // Simple external module support
            if (importPath === 'react') return React;

            const pathParts = importerPath.split('/');
            pathParts.pop();
            const base = \`file://\${pathParts.join('/')}/\`;
            // Resolve relative paths like ../components/Editor
            const baseResolvedPath = new URL(importPath, base).pathname;

            let finalResolvedPath = null;
            // Try to resolve extensions .tsx, .ts, or index files
            const possiblePaths = [
                baseResolvedPath,
                \`\${baseResolvedPath}.tsx\`,
                \`\${baseResolvedPath}.ts\`,
                \`\${baseResolvedPath}/index.tsx\`,
                \`\${baseResolvedPath}/index.ts\`
            ];

            for (const p of possiblePaths) {
                if (projectFiles.hasOwnProperty(p)) {
                    finalResolvedPath = p;
                    break;
                }
            }

            if (!finalResolvedPath) {
                throw new Error(\`Module not found: Can't import '\${importPath}' from '\${importerPath}' (resolved to '\${baseResolvedPath}')\`);
            }

            if (moduleCache[finalResolvedPath]) {
                return moduleCache[finalResolvedPath].exports;
            }

            const fileContent = projectFiles[finalResolvedPath];
            const transformedCode = Babel.transform(fileContent, {
                filename: finalResolvedPath, // Required for TS preset
                presets: ['react', 'typescript'],
                plugins: [['transform-modules-commonjs', { "strictMode": false }]]
            }).code;

            const module = { exports: {} };
            moduleCache[finalResolvedPath] = module;
            const factory = new Function('React', 'require', 'module', 'exports', transformedCode);
            // Each module gets its own require function scoped to its path
            const scopedRequire = (p) => customRequire(finalResolvedPath, p);

            factory(React, scopedRequire, module, module.exports);
            return module.exports;
        };

        try {
            // The initial require starts from the root
            const MainKernelComponent = customRequire('/boot/kernel.tsx', '/boot/kernel.tsx').default;
            if (typeof MainKernelComponent !== 'function') {
                throw new Error("Kernel entry point ('/boot/kernel.tsx') did not export a default component.");
            }
            setKernelComponent(() => MainKernelComponent);
        } catch (e) {
            console.error("OS Boot Error:", e);
            setBootError(e.message);
            setKernelComponent(null);
        }
    }, 50);
  }, [projectFiles]);


  React.useEffect(() => {
    runProject();
  }, [runProject]);

  const handleEvolveRequest = async (filePath, goal) => {
    if (!goal) {
      setBootError("Cannot evolve: goal must be specified.");
      return;
    }
    setIsEvolving(true);
    setBootError(null);
    try {
      const evolution = await evolveCode(filePath, goal, projectFiles);
      setProjectFiles(prevFiles => {
        const newFiles = { ...prevFiles };
        switch(evolution.action) {
          case 'UPDATE':
          case 'CREATE':
            newFiles[evolution.filePath] = evolution.code;
            break;
          case 'DELETE':
            delete newFiles[evolution.filePath];
            break;
          default:
            // This case should ideally not be reached if the AI respects the schema
            throw new Error(\`Unknown action from AI: \${evolution.action}\`);
        }
        return newFiles;
      });

    } catch (err) {
      setBootError(\`Evolution failed: \${err.message}\`);
    } finally {
      setIsEvolving(false);
    }
  };

  const handleFileChange = (filePath, newContent) => {
      setProjectFiles(prevFiles => ({
          ...prevFiles,
          [filePath]: newContent,
      }));
  };

  // The OS's own UI
  if (isEvolving) {
    return (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-fade-in">
          <div className="animate-spin h-8 w-8 text-white" dangerouslySetInnerHTML={{__html: \`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>\`}} />
          <p className="mt-4 text-slate-300">Evolving...</p>
        </div>
    );
  }

  if (bootError) {
     return (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-left max-w-2xl w-full">
                <strong className="font-bold">Operating System Boot Error!</strong>
                <p className="mt-2 text-sm">The application kernel failed to compile or run. You may need to fix the code that caused the error or reset the project.</p>
                <pre className="text-xs whitespace-pre-wrap mt-2 font-mono bg-red-950/50 p-2 rounded">{bootError}</pre>
                 <button 
                    onClick={onFactoryReset}
                    className="mt-4 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded">
                    Factory Reset
                 </button>
            </div>
        </div>
      );
  }

  if (KernelComponent) {
    return (
      <React.Fragment>
        {isEvolving && (
             <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-fade-in">
              <div className="animate-spin h-8 w-8 text-white" dangerouslySetInnerHTML={{__html: \`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>\`}} />
              <p className="mt-4 text-slate-300">Evolving...</p>
            </div>
        )}
        <KernelComponent
          projectFiles={projectFiles}
          onFileChange={handleFileChange}
          onEvolveRequest={handleEvolveRequest}
          onProjectReset={onFactoryReset}
        />
      </React.Fragment>
    );
  }

  // This should only be visible for a fraction of a second during initial kernel compile
  return null; 
}
export default Bootloader;
`,
  '/boot/kernel.tsx': `
import FileExplorer from '../components/FileExplorer';
import Editor from '../components/Editor';
import EvolveIcon from '../components/EvolveIcon';

// This is the main "Kernel" component for the IDE application.
// It receives the virtual file system and callbacks from the bootloader.
function Kernel({ projectFiles, onFileChange, onEvolveRequest, onProjectReset }) {
  const [activeFile, setActiveFile] = React.useState('/boot/kernel.tsx');
  const [evolutionGoal, setEvolutionGoal] = React.useState('Make the file explorer collapsible');
  const [isLoading, setIsLoading] = React.useState(false);

  const activeFileContent = projectFiles[activeFile] || '';

  const handleEvolve = async () => {
      setIsLoading(true);
      await onEvolveRequest(activeFile, evolutionGoal);
      setIsLoading(false);
  }

  const handleFileDelete = (filePath) => {
    if(window.confirm(\`Are you sure you want to delete \${filePath}?\`)) {
        onEvolveRequest(filePath, \`Delete the file at path: \${filePath}\`);
    }
  };

  const handleFileCreate = () => {
    const newFilePath = window.prompt("Enter the full path for the new file (e.g., /components/New.tsx):");
    if (newFilePath && newFilePath.startsWith('/')) {
        onEvolveRequest(newFilePath, \`Create a new empty React component at: \${newFilePath}\`);
    } else if (newFilePath) {
        alert("Invalid path. It must start with '/'.");
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 flex flex-col selection:bg-purple-500 selection:text-purple-100 animate-fade-in">
      <header className="bg-slate-950/70 backdrop-blur-sm p-4 border-b border-slate-800 text-center z-10 sticky top-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <EvolveIcon className="w-7 h-7 text-purple-400"/>
            <h1 className="text-2xl font-bold tracking-wider text-slate-300">
              Evolvable OS IDE
            </h1>
          </div>
          <button
              onClick={onProjectReset}
              className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-1 px-3 rounded-md transition-colors"
          >
            Factory Reset
          </button>
      </header>

      <div className="flex-grow grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[350px_1fr] h-[calc(100vh-73px)]">
        <div className="flex flex-col bg-slate-800/50 border-r border-slate-800 h-full overflow-y-auto">
           <FileExplorer 
             files={projectFiles}
             activeFile={activeFile}
             onFileSelect={setActiveFile}
             onFileCreate={handleFileCreate}
             onFileDelete={handleFileDelete}
           />
        </div>

        <div className="flex flex-col h-full">
            <div className="flex-grow flex flex-col">
              <Editor
                  filePath={activeFile}
                  content={activeFileContent}
                  onContentChange={(newContent) => onFileChange(activeFile, newContent)}
              />
            </div>
            <div className="bg-slate-800/80 border-t border-slate-700 p-3 space-y-2">
              <label htmlFor="goal" className="block text-sm font-medium text-slate-300">Evolution Goal for {activeFile}</label>
              <div className="flex gap-2">
                <input
                  id="goal"
                  type="text"
                  value={evolutionGoal}
                  onChange={(e) => setEvolutionGoal(e.target.value)}
                  placeholder="Describe how to evolve the project..."
                  className="flex-grow bg-slate-700 border border-slate-600 rounded-md p-2 text-slate-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
                />
                 <button
                    onClick={handleEvolve}
                    disabled={!evolutionGoal.trim() || isLoading}
                    className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-md transition-all duration-300 disabled:bg-purple-900 disabled:cursor-not-allowed"
                >
                    {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <EvolveIcon className="w-5 h-5"/>}
                     Evolve
                </button>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
export default Kernel;
  `,
  '/components/FileExplorer.tsx': `
function DeleteIcon({ className }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.033-2.134H8.716c-1.123 0-2.033.954-2.033 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
    );
}

function FileExplorer({ files, activeFile, onFileSelect, onFileCreate, onFileDelete }) {
    const filePaths = Object.keys(files).sort((a,b) => {
      // Sort boot files to the top
      if (a.startsWith('/boot/') && !b.startsWith('/boot/')) return -1;
      if (!a.startsWith('/boot/') && b.startsWith('/boot/')) return 1;
      return a.localeCompare(b);
    });

    return (
        <div className="p-2 flex flex-col h-full">
            <div className="flex items-center justify-between px-2 mb-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Project Files</h2>
                <button 
                    onClick={onFileCreate}
                    className="text-slate-400 hover:text-slate-100"
                    title="Create New File"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                </button>
            </div>
            <ul className="space-y-1 flex-grow overflow-y-auto">
                {filePaths.map(path => (
                    <li key={path} className="group flex items-center">
                        <button 
                            onClick={() => onFileSelect(path)}
                            className={\`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors flex-grow \${activeFile === path ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-700/50'}\`}
                        >
                            {path.startsWith('/boot/') && '🔴 '}{path.substring(path.lastIndexOf('/') + 1)}
                        </button>
                        {!path.startsWith('/boot/') && (
                             <button 
                                onClick={(e) => {e.stopPropagation(); onFileDelete(path);}}
                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1 flex-shrink-0"
                                title={\`Delete \${path}\`}
                            >
                                <DeleteIcon className="w-4 h-4" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
export default FileExplorer;
  `,
  '/components/Editor.tsx': `
function Editor({ filePath, content, onContentChange }) {
    const textAreaRef = React.useRef(null);
    const lineNumbersRef = React.useRef(null);

    const syncScroll = React.useCallback(() => {
        if (lineNumbersRef.current && textAreaRef.current) {
            lineNumbersRef.current.scrollTop = textAreaRef.current.scrollTop;
        }
    }, []);

    React.useEffect(() => {
        syncScroll();
    }, [content, filePath, syncScroll]);

    const lines = React.useMemo(() => content.split('\\n').length, [content]);
    const lineNumbers = React.useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join('\\n'), [lines]);

    return (
      <div className="w-full h-full flex flex-col bg-slate-800 relative">
         <div className="flex-shrink-0 p-3 border-b border-slate-700 bg-slate-900 z-10">
            <span className="font-mono text-sm text-slate-400">{filePath}</span>
         </div>
         <div className="flex-grow flex w-full h-full overflow-hidden">
            <pre
              ref={lineNumbersRef}
              aria-hidden="true"
              className="w-12 text-right pr-4 py-3 text-slate-500 font-mono text-sm bg-slate-800 select-none"
            >
                {lineNumbers}
            </pre>
            <textarea
                ref={textAreaRef}
                key={filePath} // Force re-mount on file change to reset scroll
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                onScroll={syncScroll}
                className="w-full h-full flex-grow bg-transparent py-3 font-mono text-sm text-slate-200 focus:outline-none resize-none leading-relaxed"
                spellCheck="false"
                wrap="off"
            />
         </div>
      </div>
    );
}
export default Editor;
  `,
  '/components/EvolveIcon.tsx': `
const EvolveIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
  </svg>
);
export default EvolveIcon;
  `,
'/components/LoadingSpinner.tsx': `
const LoadingSpinner = () => (
  <svg
    className="animate-spin h-8 w-8 text-white"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);
export default LoadingSpinner;
`
};