
import React, { useState, useEffect, useCallback } from 'react';
import { INITIAL_PROJECT } from './initialProject';
import LoadingSpinner from './components/Spinner';

// This global is available because we added the Babel script in index.html
declare var Babel: any;

const LOCAL_STORAGE_KEY = 'self-evolving-project-files-v2';

// A React Error Boundary component defined directly in the BIOS.
// This acts as a top-level safety net to catch runtime errors from the dynamic
// application (Bootloader, Kernel, etc.) and prevent a total crash.
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state to trigger the fallback UI on the next render.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Capture more details about the error, like the component stack.
    this.setState({ errorInfo });
    console.error("Caught a runtime error in a child component:", error, errorInfo);
  }

  handleReset = () => {
    if (window.confirm("Are you sure? This will reset the entire project to its factory state.")) {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
        window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      // Render a fallback UI instead of the crashed component tree.
      return (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-left max-w-2xl w-full">
                <strong className="font-bold">Fatal Application Runtime Error!</strong>
                <p className="mt-2 text-sm">The application has crashed due to an unhandled error, likely from a recent evolution. Please review the error and consider resetting the project.</p>
                <pre className="text-xs whitespace-pre-wrap mt-2 font-mono bg-red-950/50 p-2 rounded">
                  {this.state.error?.toString()}
                  {this.state.errorInfo && `\n\nComponent Stack:\n${this.state.errorInfo.componentStack}`}
                </pre>
                 <button 
                    onClick={this.handleReset}
                    className="mt-4 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded">
                    Factory Reset
                 </button>
            </div>
        </div>
      );
    }
    return this.props.children; 
  }
}


/**
 * Pre-scans and sanitizes code for common Babel parsing errors.
 * This acts as a safety net to fix trivial syntax issues that might
 * be introduced by AI, preventing the entire BIOS from crashing.
 * @param code The raw source code string.
 * @returns The sanitized code string.
 */
const sanitizeCodeForBabel = (code: string): string => {
  // Fixes invalid Unicode escape sequences in strings which is a common Babel error.
  // e.g., a string like "hello \world" would crash Babel. This regex finds
  // backslashes that are NOT part of a valid escape sequence (like \n, \t, \', \", \\)
  // or a valid unicode sequence (\uXXXX) and escapes the backslash itself.
  return code.replace(/\\(?![nt'"\\/]|u[0-9a-fA-F]{4})/g, '\\\\');
};


// This is the static "BIOS" of the application.
// Its job is to load external dependencies for the OS, then load the project files
// and hand off control to the dynamic bootloader.
const App: React.FC = () => {
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>(() => {
    try {
      const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      return saved ? JSON.parse(saved) : INITIAL_PROJECT;
    } catch (e) {
      console.error("Failed to load project from localStorage", e);
      return INITIAL_PROJECT;
    }
  });

  const [externalModules, setExternalModules] = useState<Record<string, any> | null>(null);
  const [BootloaderComponent, setBootloaderComponent] = useState<React.ComponentType<any> | null>(null);
  const [biosError, setBiosError] = useState<string | null>(null);

  const saveProjectFiles = useCallback((files: Record<string, string>) => {
      try {
        const stateToSave = JSON.stringify(files);
        window.localStorage.setItem(LOCAL_STORAGE_KEY, stateToSave);
        setProjectFiles(files);
      } catch (e) {
        console.error("Failed to save project to localStorage", e);
        setBiosError("Failed to save project files. Check console for details.");
      }
  }, []);

  const handleFactoryReset = useCallback(() => {
    if (window.confirm("Are you sure? This will reset the entire project to its factory state and reload the application.")) {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
        window.location.reload();
    }
  }, []);
  
  // Step 1: BIOS loads critical external dependencies for the OS (Bootloader)
  useEffect(() => {
    console.log("BIOS: Loading external dependencies for the OS...");
    setBiosError(null);
    import('@google/genai')
        .then(genaiModule => {
            setExternalModules({
                '@google/genai': genaiModule,
                'react': React, // Provide React through the same mechanism for consistency
            });
            console.log("BIOS: Dependencies loaded successfully.");
        })
        .catch(err => {
            console.error("BIOS Error: Failed to load dependencies", err);
            setBiosError(`Fatal: Could not load critical dependency '@google/genai'. ${err.message}`);
        });
  }, []); // Runs only once on mount

  // Step 2: Once dependencies are loaded, BIOS transpiles and runs the OS (Bootloader)
  useEffect(() => {
    // Wait for external modules to be loaded by the BIOS.
    if (!externalModules) {
        return;
    }

    console.log("BIOS: Loading dynamic bootloader...");
    // Reset component and error state before trying to load
    setBootloaderComponent(null);
    setBiosError(null);

    try {
      const bootloaderCode = projectFiles['/boot/bootloader.tsx'];
      if (!bootloaderCode) {
        throw new Error("Critical file /boot/bootloader.tsx not found in project.");
      }

      const sanitizedCode = sanitizeCodeForBabel(bootloaderCode);

      const transformedCode = Babel.transform(sanitizedCode, {
          filename: '/boot/bootloader.tsx',
          presets: ['react', 'typescript'],
          plugins: [['transform-modules-commonjs', { "strictMode": false }]]
      }).code;

      const module: { exports: any } = { exports: {} };
      // The 'process' object is injected for the bootloader to access environment variables.
      const factory = new Function('React', 'require', 'module', 'exports', 'process', transformedCode);
      
      const biosRequire = (path: string) => {
          if (externalModules[path]) {
              return externalModules[path];
          }
          throw new Error(`BIOS does not support require. Path: ${path}`);
      };

      // Create a process stub for the sandboxed environment of the bootloader.
      // NOTE: This assumes process.env.API_KEY is available in the main app's context.
      const processStub = {
          env: {
              API_KEY: process.env.API_KEY
          }
      };

      factory(React, biosRequire, module, module.exports, processStub);

      const mainComponent = module.exports.default;
      if (typeof mainComponent !== 'function') {
        throw new Error("Bootloader component did not export a default React component.");
      }

      setBootloaderComponent(() => mainComponent);
    } catch(e: any) {
      console.error("BIOS Error:", e);
      setBiosError(e.message);
    }
  }, [projectFiles, externalModules]); // Re-run when files change OR when modules are loaded

  if (biosError) {
    return (
       <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-left max-w-2xl w-full">
                <strong className="font-bold">Fatal BIOS Error!</strong>
                <p className="mt-2 text-sm">The core bootloader failed to load. The application cannot start. You may need to reset the project.</p>
                <pre className="text-xs whitespace-pre-wrap mt-2 font-mono bg-red-950/50 p-2 rounded">{biosError}</pre>
                 <button 
                    onClick={handleFactoryReset}
                    className="mt-4 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded">
                    Factory Reset
                 </button>
            </div>
        </div>
    );
  }

  // Show loading spinner while dependencies are loading or bootloader is compiling
  if (!BootloaderComponent || !externalModules) {
    return <div className="w-full h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <ErrorBoundary>
      <BootloaderComponent 
        initialFiles={projectFiles} 
        onSaveFiles={saveProjectFiles}
        onFactoryReset={handleFactoryReset} 
      />
    </ErrorBoundary>
  );
};

export default App;
