import { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { UploadCloud, FileVideo, CheckCircle, Loader2, DownloadCloud, HardDrive, Folder } from 'lucide-react';
import { useGoogleAuth, API_KEY, APP_ID } from './useGoogleAuth';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);
  
  // Destination State
  const [destination, setDestination] = useState<'local' | 'gdrive' | null>(null);
  const [gdriveFolderId, setGdriveFolderId] = useState<string | null>(null);
  const [gdriveFolderName, setGdriveFolderName] = useState<string | null>(null);

  const [watermarkedVideo, setWatermarkedVideo] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logMessage, setLogMessage] = useState<string>('Initializing FFmpeg...');

  const googleAuth = useGoogleAuth();
  const ffmpegRef = useRef(new FFmpeg());

  const loadFFmpeg = async () => {
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = ffmpegRef.current;

      ffmpeg.on('log', ({ message }) => {
        setLogMessage(message);
      });

      ffmpeg.on('progress', ({ progress }) => {
        setProgress(progress * 100);
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setLoaded(true);
      setLogMessage('FFmpeg loaded and ready.');
    } catch (error) {
      console.error("Error loading FFmpeg:", error);
      setLogMessage('Failed to load FFmpeg.');
    }
  };

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setVideoFile(e.target.files[0]);
    }
  };

  const handleWatermarkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setWatermarkFile(e.target.files[0]);
    }
  };

  const handleDriveImport = async (type: 'video' | 'image') => {
    let token = googleAuth.accessToken;
    if (!token) {
      try {
        console.log("Calling login promise...");
        token = await googleAuth.login();
        console.log("Login Promise Resolved", !!token);
      } catch (e) {
        console.log("Login Promise Rejected");
        return;
      }
    }

    if (!window.google || !window.google.picker) {
      alert("Critical Error: window.google.picker is undefined! Check if Google APIs loaded properly.");
      return;
    }

    const mimeTypes = type === 'video' ? 'video/mp4,video/x-m4v,video/*' : 'image/png,image/jpeg,image/*';
    
    try {
      console.log("Building Picker Views...");
      const myDriveView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setMimeTypes(mimeTypes)
        .setIncludeFolders(true)
        .setEnableDrives(true);

      const sharedView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setMimeTypes(mimeTypes)
        .setIncludeFolders(true)
        .setOwnedByMe(false);

      console.log("Initializing PickerBuilder...");
      const picker = new window.google.picker.PickerBuilder()
        .setAppId(APP_ID)
        .setOAuthToken(token)
        .addView(myDriveView)
        .addView(sharedView)
        .setDeveloperKey(API_KEY)
        .setCallback(async (data: any) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const file = data.docs[0];
            setLogMessage(`Downloading ${file.name} from Google Drive...`);
            setIsProcessing(true);

            try {
              const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!res.ok) throw new Error("Failed to download from Drive. Check permissions.");

              const blob = await res.blob();
              const importedFile = new File([blob], file.name, { type: blob.type });
              if (type === 'video') {
                setVideoFile(importedFile);
              } else {
                setWatermarkFile(importedFile);
              }
              setLogMessage(`Successfully imported ${file.name}`);
            } catch (err: any) {
              console.error(err);
              setLogMessage(`Download failed: ${err.message}`);
            } finally {
              setIsProcessing(false);
            }
          }
        })
        .build();

      console.log("Setting Picker Visible...");
      picker.setVisible(true);
    } catch (e: any) {
      console.error("Picker Build Exception:", e);
      alert("The Google Picker crashed: " + e.message);
    }
  };

  const handleFolderPick = async () => {
    let token = googleAuth.accessToken;
    if (!token) {
      try {
        token = await googleAuth.login();
      } catch (e) {
        return;
      }
    }

    const myDriveFolders = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true);

    const sharedFolders = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false);

    const picker = new window.google.picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .addView(myDriveFolders)
      .addView(sharedFolders)
      .setDeveloperKey(API_KEY)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const folder = data.docs[0];
          setGdriveFolderId(folder.id);
          setGdriveFolderName(folder.name);
          setDestination('gdrive');
        }
      })
      .build();

    picker.setVisible(true);
  };

  const applyWatermark = async () => {
    if (!videoFile || !watermarkFile || !destination) return;

    setIsProcessing(true);
    setProgress(0);
    const ffmpeg = ffmpegRef.current;

    try {
      setLogMessage('Reading video to memory...');
      await ffmpeg.writeFile('input-video.mp4', await fetchFile(videoFile));
      await ffmpeg.writeFile('watermark.png', await fetchFile(watermarkFile));

      setLogMessage('Processing video with watermark (this may take a while)...');
      await ffmpeg.exec([
        '-i', 'input-video.mp4',
        '-i', 'watermark.png',
        '-filter_complex', 'overlay=W-w-10:H-h-35',
        '-codec:a', 'copy',
        'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(videoBlob);
      setWatermarkedVideo(videoUrl);
      
      if (destination === 'local') {
        setLogMessage('Processing complete! Downloading to local PC...');
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = `watermarked_video_${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setLogMessage('Successfully downloaded to Local PC!');
      } else if (destination === 'gdrive' && gdriveFolderId) {
        setIsUploading(true);
        setLogMessage(`Pushing to Google Drive folder: ${gdriveFolderName}...`);
        
        const metadata = {
          name: `watermarked_video_${Date.now()}.mp4`,
          parents: [gdriveFolderId]
        };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', videoBlob);

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { Authorization: `Bearer ${googleAuth.accessToken}` },
          body: form
        });
        
        if (!res.ok) throw new Error("Google Drive API failed to save the file.");
        setLogMessage('Successfully published your video to Google Drive!');
      }

    } catch (err: any) {
      console.error(err);
      setLogMessage(`An error occurred: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setIsUploading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-900 to-black p-4 selection:bg-blue-500/30">
        <div className="max-w-md w-full bg-white/5 backdrop-blur-2xl p-10 rounded-[2rem] border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col space-y-8 animate-in zoom-in-95 duration-700">
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 drop-shadow-md tracking-tight">Restricted Access</h2>
            <p className="text-sm text-gray-400 font-medium">Please authenticate to establish connection</p>
          </div>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Username" 
              className="w-full p-4 bg-black/50 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent text-white placeholder-gray-600 transition-all font-medium" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
            />
            <input 
              type="password" 
              placeholder="Password" 
              className="w-full p-4 bg-black/50 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent text-white placeholder-gray-600 transition-all font-medium" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (username === 'Nithin' && password === 'Spidy@22') setIsAuthenticated(true);
                  else alert('Invalid credentials');
                }
              }}
            />
          </div>
          <button 
            onClick={() => { 
              if (username === 'Nithin' && password === 'Spidy@22') setIsAuthenticated(true); 
              else alert('Invalid credentials'); 
            }} 
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_35px_rgba(79,70,229,0.5)] font-bold rounded-2xl transition-all duration-300 tracking-wide text-lg"
          >
            Terminal Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-[#050505] to-black p-4 sm:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto space-y-12">
        <header className="text-center space-y-4 pt-8 pb-4 animate-in fade-in slide-in-from-top-8 duration-1000">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-500 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">
            Drive Video Watermarker
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto font-light tracking-wide">
            Source your video, select a destination, and render flawlessly in a specialized 3D environment.
          </p>
        </header>

        {!loaded && (
          <div className="flex items-center justify-center p-12 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mr-4" />
            <span className="text-xl font-medium text-gray-200 tracking-wide">{logMessage}</span>
          </div>
        )}

        {loaded && (
          <main className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            {/* Left Column - Inputs */}
            <div className="space-y-8 perspective-1000">
              
              {/* Step 1: Video */}
              <div className="group bg-gradient-to-b from-white/[0.05] to-transparent p-6 sm:p-8 rounded-3xl border border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:border-white/20 transition-all duration-500 backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30 text-blue-400 font-bold">1</div>
                  <label className="text-lg font-semibold text-white tracking-wide">Select Target Video</label>
                </div>
                
                <div className="grid grid-cols-1 gap-4 mb-6">
                  <button
                    onClick={() => handleDriveImport('video')}
                    disabled={!googleAuth.isReady || isProcessing || isUploading}
                    className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white disabled:opacity-50 font-semibold rounded-2xl shadow-lg transition-all flex justify-center items-center cursor-pointer disabled:cursor-not-allowed group-hover:border-white/20"
                  >
                    <DownloadCloud className="w-5 h-5 mr-2 text-blue-400" />
                    {!googleAuth.isReady ? 'Loading Google Services...' : (!googleAuth.accessToken ? 'Login to Import from Drive' : 'Import from Google Drive')}
                  </button>
                  <div className="flex items-center justify-center gap-4 my-2 opacity-50"><div className="h-px bg-white/20 w-full"></div><span className="text-xs text-white uppercase tracking-widest font-bold">OR LOCAL VIA PC</span><div className="h-px bg-white/20 w-full"></div></div>
                </div>

                <div className="border border-dashed border-white/20 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white/5 hover:border-blue-500/50 transition-all duration-300 relative group/dropzone bg-black/20">
                  <input type="file" accept="video/*" onChange={handleVideoUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" disabled={isProcessing} />
                  {videoFile ? (
                    <div className="flex flex-col items-center transform transition-transform group-hover/dropzone:scale-105">
                      <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-3 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                        <FileVideo className="w-8 h-8 text-blue-400" />
                      </div>
                      <span className="font-semibold text-white tracking-wide truncate max-w-[200px]">{videoFile.name}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center transform transition-transform group-hover/dropzone:scale-105">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
                        <UploadCloud className="w-8 h-8 text-gray-400 group-hover/dropzone:text-blue-400 transition-colors" />
                      </div>
                      <span className="text-gray-400 font-medium tracking-wide">Drag & drop or browse</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Watermark */}
              <div className="group bg-gradient-to-b from-white/[0.05] to-transparent p-6 sm:p-8 rounded-3xl border border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:border-white/20 transition-all duration-500 backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30 text-purple-400 font-bold">2</div>
                  <label className="text-lg font-semibold text-white tracking-wide">Select Watermark Image</label>
                </div>
                
                <div className="grid grid-cols-1 gap-4 mb-6">
                  <button
                    onClick={() => handleDriveImport('image')}
                    disabled={!googleAuth.isReady || isProcessing || isUploading}
                    className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white disabled:opacity-50 font-semibold rounded-2xl shadow-lg transition-all flex justify-center items-center cursor-pointer disabled:cursor-not-allowed group-hover:border-white/20"
                  >
                    <DownloadCloud className="w-5 h-5 mr-2 text-purple-400" />
                    {!googleAuth.isReady ? 'Loading Google Services...' : (!googleAuth.accessToken ? 'Login to Import from Drive' : 'Import from Google Drive')}
                  </button>
                  <div className="flex items-center justify-center gap-4 my-2 opacity-50"><div className="h-px bg-white/20 w-full"></div><span className="text-xs text-white uppercase tracking-widest font-bold">OR LOCAL VIA PC</span><div className="h-px bg-white/20 w-full"></div></div>
                </div>

                <div className="border border-dashed border-white/20 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-white/5 hover:border-purple-500/50 transition-all duration-300 relative group/dropzone bg-black/20">
                  <input type="file" accept="image/*" onChange={handleWatermarkUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" disabled={isProcessing} />
                  {watermarkFile ? (
                    <div className="flex flex-col items-center transform transition-transform group-hover/dropzone:scale-105">
                      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-3 border border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                        <CheckCircle className="w-8 h-8 text-green-400" />
                      </div>
                      <span className="font-semibold text-white tracking-wide truncate max-w-[200px]">{watermarkFile.name}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center transform transition-transform group-hover/dropzone:scale-105">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
                        <UploadCloud className="w-8 h-8 text-gray-400 group-hover/dropzone:text-purple-400 transition-colors" />
                      </div>
                      <span className="text-gray-400 font-medium tracking-wide">Drag & drop or browse</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Destination */}
              <div className="group bg-gradient-to-b from-white/[0.05] to-transparent p-6 sm:p-8 rounded-3xl border border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:border-white/20 transition-all duration-500 backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 text-emerald-400 font-bold">3</div>
                  <label className="text-lg font-semibold text-white tracking-wide">Set Final Destination</label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => { setDestination('local'); setGdriveFolderId(null); setGdriveFolderName(null); }}
                    disabled={isProcessing || isUploading}
                    className={`py-6 px-4 flex flex-col items-center justify-center rounded-2xl border transition-all duration-300 ${destination === 'local' ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)] text-emerald-300' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-gray-400'}`}
                  >
                    <HardDrive className={`w-8 h-8 mb-3 ${destination === 'local' ? 'text-emerald-400 scale-110' : 'text-gray-500'} transition-transform duration-300`} />
                    <span className="font-semibold tracking-wide">Local PC</span>
                  </button>
                  
                  <button
                    onClick={handleFolderPick}
                    disabled={!googleAuth.isReady || isProcessing || isUploading}
                    className={`py-6 px-4 flex flex-col items-center justify-center rounded-2xl border transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${destination === 'gdrive' ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)] text-emerald-300' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-gray-400'}`}
                  >
                    <Folder className={`w-8 h-8 mb-3 ${destination === 'gdrive' ? 'text-emerald-400 scale-110' : 'text-gray-500'} transition-transform duration-300`} />
                    <span className="font-semibold tracking-wide text-center leading-tight">
                       {gdriveFolderName ? `Drive: ${gdriveFolderName}` : 'Google Drive Folder'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Step 4: Process */}
              <button
                onClick={applyWatermark}
                disabled={!videoFile || !watermarkFile || !destination || isProcessing || isUploading}
                className="w-full py-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 disabled:from-white/10 disabled:to-white/10 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed text-white text-xl font-extrabold rounded-3xl shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_50px_rgba(79,70,229,0.6)] hover:-translate-y-1 transition-all duration-500 flex flex-col items-center justify-center relative overflow-hidden group tracking-wide border border-white/10"
              >
                {isProcessing || isUploading ? (
                  <>
                    <div className="flex items-center">
                      <Loader2 className="w-6 h-6 animate-spin mr-3 relative z-10 text-white drop-shadow-md" />
                      <span className="relative z-10 drop-shadow-md">Rendering Sequence: {Math.round(progress)}%</span>
                    </div>
                    <div className="absolute inset-0 bg-white/20 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
                  </>
                ) : (
                  <span className="drop-shadow-lg">4. Process & Auto-Export 🚀</span>
                )}
              </button>
            </div>

            {/* Right Column - Output & Logs */}
            <div className="bg-black/50 backdrop-blur-2xl p-8 rounded-3xl border border-white/10 shadow-[0_8px_40px_rgb(0,0,0,0.8)] flex flex-col items-center justify-center text-center min-h-[600px] sticky top-8 group hover:border-white/20 transition-all duration-500">
              {watermarkedVideo ? (
                <div className="w-full space-y-6 animate-in zoom-in-95 duration-500">
                  <h3 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600 drop-shadow-sm">Final Master Render</h3>
                  <div className="relative rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.8)] border border-white/10 p-1 bg-white/5">
                    <video src={watermarkedVideo} controls className="w-full rounded-xl bg-black" />
                  </div>
                  <div className="mt-6 p-5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-2xl font-medium flex items-center justify-center backdrop-blur-md shadow-[0_0_20px_rgba(34,197,94,0.1)]">
                    <CheckCircle className="w-6 h-6 mr-3 flex-shrink-0" />
                    Successfully {destination === 'local' ? 'Downloaded to PC' : `Published to ${gdriveFolderName}`}
                  </div>
                </div>
              ) : (
                <div className="text-gray-500 max-w-sm flex flex-col items-center space-y-6">
                  <div className="w-32 h-32 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shadow-[inset_0_0_20px_rgba(255,255,255,0.02)] group-hover:shadow-[inset_0_0_40px_rgba(255,255,255,0.05)] transition-all duration-700">
                    <FileVideo className="w-16 h-16 opacity-30 group-hover:opacity-50 transition-opacity duration-700" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-300 tracking-tight">Awaiting Telemetry</h3>
                  <p className="text-sm font-medium leading-relaxed opacity-70">Execute steps 1-4 on the terminal sequence. The rendering viewport and log feed will initialize here.</p>
                </div>
              )}
              
              <div className="w-full mt-10 p-5 bg-black/80 text-blue-400 font-mono text-sm text-left rounded-2xl h-40 overflow-y-auto border border-blue-500/20 shadow-[inset_0_0_15px_rgba(0,0,0,1)] relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-50"></div>
                {logMessage}
              </div>
            </div>
          </main>
        )}

        {/* Developer Footer */}
        <footer className="w-full text-center py-10 mt-12 opacity-50 hover:opacity-100 transition-opacity duration-500">
          <p className="text-sm font-medium text-gray-500 flex items-center justify-center gap-2">
            Developed by
            <a
              href="https://github.com/2nithin2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white font-bold px-3 py-1.5 bg-white/5 rounded-lg shadow-[0_0_10px_rgba(255,255,255,0.05)] border border-white/10 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all flex items-center gap-1.5"
            >
              Nithin
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
