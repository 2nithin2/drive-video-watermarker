import { useState } from 'react';
import { UploadCloud, Folder, Check } from 'lucide-react';
import { API_KEY, APP_ID } from './useGoogleAuth';

interface Props {
  videoUrl: string | null;
  googleAuth: {
    accessToken: string | null;
    isReady: boolean;
    login: () => void;
  }
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export default function GoogleDriveUploader({ videoUrl, googleAuth }: Props) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const handlePicker = () => {
    if (!googleAuth.accessToken || !googleAuth.isReady) return;

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);

    const picker = new window.google.picker.PickerBuilder()
      .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setAppId(APP_ID)
      .setOAuthToken(googleAuth.accessToken)
      .addView(view)
      .setDeveloperKey(API_KEY)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const folder = data.docs[0];
          setSelectedFolderId(folder.id);
          setUploadStatus(`Selected folder: ${folder.name}`);
        }
      })
      .build();

    picker.setVisible(true);
  };

  const handleUpload = async () => {
    if (!videoUrl || !selectedFolderId || !googleAuth.accessToken) return;

    setIsUploading(true);
    setUploadStatus('Preparing to upload...');

    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();

      const metadata = {
        name: `watermarked_video_${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        parents: [selectedFolderId],
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      setUploadStatus('Uploading to Google Drive... This might take a while.');

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleAuth.accessToken}`,
        },
        body: form,
      });

      if (uploadRes.ok) {
        setUploadStatus('Upload successful! Check your Drive.');
      } else {
        const errorData = await uploadRes.json();
        console.error(errorData);
        setUploadStatus('Upload failed. Check Developer Console.');
      }
    } catch (err) {
      console.error(err);
      setUploadStatus('An error occurred during upload.');
    } finally {
      setIsUploading(false);
    }
  };

  if (!videoUrl) return null;

  return (
    <div className="w-full mt-6 bg-primary-50 p-6 rounded-xl border border-primary-100 space-y-4 text-left">
      <h3 className="text-lg font-bold text-gray-800 flex items-center">
        <UploadCloud className="mr-2" /> Publish to Google Drive
      </h3>

      {uploadStatus && <p className="text-sm font-medium text-primary-700">{uploadStatus}</p>}

      {!googleAuth.accessToken ? (
        <button
          onClick={googleAuth.login}
          disabled={!googleAuth.isReady}
          className="w-full py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold rounded-xl shadow-sm transition-all"
        >
          {googleAuth.isReady ? 'Sign in with Google' : 'Loading Google APIs...'}
        </button>
      ) : (
        <div className="space-y-4">
          <button
            onClick={handlePicker}
            className="w-full py-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold rounded-xl shadow-sm transition-all flex justify-center items-center"
          >
            <Folder className="w-5 h-5 mr-2" />
            {selectedFolderId ? 'Change Destination Folder' : 'Select Destination Folder'}
          </button>

          {selectedFolderId && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold rounded-xl shadow-sm transition-all flex justify-center items-center"
            >
              {isUploading ? 'Uploading...' : <><Check className="w-5 h-5 mr-2" /> Confirm & Upload to Drive</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
