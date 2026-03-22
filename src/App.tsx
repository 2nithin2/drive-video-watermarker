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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-800">Login</h2>
            <p className="text-sm text-gray-500">Please authenticate to continue (use admin/admin)</p>
          </div>
          <input 
            type="text" 
            placeholder="Username" 
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500" 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
          />
          <input 
            type="password" 
            placeholder="Password" 
            className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (username === 'admin' && password === 'admin') setIsAuthenticated(true);
                else alert('Invalid credentials (use admin / admin)');
              }
            }}
          />
          <button 
            onClick={() => { 
              if (username === 'admin' && password === 'admin') setIsAuthenticated(true); 
              else alert('Invalid credentials (use admin / admin)'); 
            }} 
            className="w-full py-3 bg-primary-600 text-white font-bold rounded-xl hover:bg-primary-700 transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-extrabold text-primary-700 tracking-tight">Drive Video Watermarker</h1>
        <p className="text-gray-500">Source your video, set your destination, and process all in one click.</p>
      </header>

      {!loaded && (
        <div className="flex items-center justify-center p-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500 mr-3" />
          <span className="text-lg font-medium text-gray-700">{logMessage}</span>
        </div>
      )}

      {loaded && (
        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            
            {/* Step 1: Video */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <label className="block text-sm font-semibold text-gray-700 mb-4">1. Select Target Video</label>
              
              <div className="grid grid-cols-1 gap-3 mb-4">
                <button
                  onClick={() => handleDriveImport('video')}
                  disabled={!googleAuth.isReady || isProcessing || isUploading}
                  className="w-full py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 disabled:text-gray-400 font-semibold rounded-xl shadow-sm transition-all flex justify-center items-center cursor-pointer disabled:cursor-not-allowed"
                >
                  <DownloadCloud className="w-5 h-5 mr-2" />
                  {!googleAuth.isReady ? 'Loading Google Services...' : (!googleAuth.accessToken ? 'Login to Import from Drive' : 'Import from Google Drive')}
                </button>
                <div className="text-center text-xs text-gray-400 font-medium">OR UPLOAD FROM PC</div>
              </div>

              <div className="border-2 border-dashed border-primary-200 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-primary-50 transition-colors relative">
                <input type="file" accept="video/*" onChange={handleVideoUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" disabled={isProcessing} />
                {videoFile ? (
                  <>
                    <FileVideo className="w-12 h-12 text-primary-500 mb-2" />
                    <span className="font-medium text-gray-900 truncate px-4">{videoFile.name}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-primary-400 mb-2" />
                    <span className="text-gray-500 font-medium text-sm">Click or pull a video from PC</span>
                  </>
                )}
              </div>
            </div>

            {/* Step 2: Watermark */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <label className="block text-sm font-semibold text-gray-700 mb-4">2. Select Watermark Image</label>
              
              <div className="grid grid-cols-1 gap-3 mb-4">
                <button
                  onClick={() => handleDriveImport('image')}
                  disabled={!googleAuth.isReady || isProcessing || isUploading}
                  className="w-full py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 disabled:text-gray-400 font-semibold rounded-xl shadow-sm transition-all flex justify-center items-center cursor-pointer disabled:cursor-not-allowed"
                >
                  <DownloadCloud className="w-5 h-5 mr-2" />
                  {!googleAuth.isReady ? 'Loading Google Services...' : (!googleAuth.accessToken ? 'Login to Import from Drive' : 'Import from Google Drive')}
                </button>
                <div className="text-center text-xs text-gray-400 font-medium">OR UPLOAD FROM PC</div>
              </div>

              <div className="border-2 border-dashed border-primary-200 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-primary-50 transition-colors relative">
                <input type="file" accept="image/*" onChange={handleWatermarkUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" disabled={isProcessing} />
                {watermarkFile ? (
                  <>
                    <CheckCircle className="w-12 h-12 text-green-500 mb-2" />
                    <span className="font-medium text-gray-900 truncate px-4">{watermarkFile.name}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-10 h-10 text-primary-400 mb-2" />
                    <span className="text-gray-500 font-medium text-sm">Click or pull an image from PC</span>
                  </>
                )}
              </div>
            </div>

            {/* Step 3: Destination */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
              <label className="block text-sm font-semibold text-gray-700 mb-4">3. Set Final Destination</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => { setDestination('local'); setGdriveFolderId(null); setGdriveFolderName(null); }}
                  disabled={isProcessing || isUploading}
                  className={`py-4 px-4 flex flex-col items-center justify-center rounded-xl border-2 transition-all ${destination === 'local' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                >
                  <HardDrive className={`w-8 h-8 mb-2 ${destination === 'local' ? 'text-primary-500' : 'text-gray-400'}`} />
                  <span className="font-semibold">Local PC</span>
                </button>
                
                <button
                  onClick={handleFolderPick}
                  disabled={!googleAuth.isReady || isProcessing || isUploading}
                  className={`py-4 px-4 flex flex-col items-center justify-center rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${destination === 'gdrive' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                >
                  <Folder className={`w-8 h-8 mb-2 ${destination === 'gdrive' ? 'text-primary-500' : 'text-gray-400'}`} />
                  <span className="font-semibold text-center">
                     {gdriveFolderName ? `Drive: ${gdriveFolderName}` : 'Google Drive Folder'}
                  </span>
                </button>
              </div>
            </div>

            {/* Step 4: Process Button */}
            <button
              onClick={applyWatermark}
              disabled={!videoFile || !watermarkFile || !destination || isProcessing || isUploading}
              className="w-full py-5 bg-gray-900 hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-lg font-bold rounded-xl shadow-md transition-all flex flex-col items-center justify-center relative overflow-hidden group"
            >
              {isProcessing || isUploading ? (
                <>
                  <div className="flex items-center">
                    <Loader2 className="w-5 h-5 animate-spin mr-3 relative z-10" />
                    <span className="relative z-10">Running Sequence: {Math.round(progress)}%</span>
                  </div>
                  <div className="absolute inset-0 bg-primary-600 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </>
              ) : (
                '4. Process & Auto-Export'
              )}
            </button>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center min-h-[500px] sticky top-8">
            {watermarkedVideo ? (
              <div className="w-full space-y-4">
                <h3 className="text-xl font-bold text-gray-800">Final Processing Output</h3>
                <video src={watermarkedVideo} controls className="w-full rounded-xl bg-black border border-gray-200 shadow-sm" />
                <div className="mt-4 p-4 bg-green-50 text-green-800 rounded-xl font-medium flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                  Successfully {destination === 'local' ? 'Downloaded to PC' : `Published to ${gdriveFolderName}`}
                </div>
              </div>
            ) : (
              <div className="text-gray-400 max-w-sm flex flex-col items-center space-y-4">
                <FileVideo className="w-20 h-20 opacity-20" />
                <h3 className="text-xl font-bold text-gray-300">No Processed Output Yet</h3>
                <p className="text-sm">Follow steps 1-4 on the left to set up your workflow. The final preview and logging status will appear here after completion.</p>
              </div>
            )}
            
            <div className="w-full mt-8 p-4 bg-gray-900 text-green-400 font-mono text-sm text-left rounded-lg h-32 overflow-y-auto">
              {logMessage}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
