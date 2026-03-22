import { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// Replace these with your actual credentials from Google Cloud Console
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
export const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
export const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;
// drive.file is enough, but including readonly just in case for older Drive APIs
export const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

export function useGoogleAuth() {
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const resolveRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((err: any) => void) | null>(null);

  useEffect(() => {
    const loadScript = (src: string, onLoad: () => void) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = onLoad;
      document.body.appendChild(script);
    };

    loadScript('https://apis.google.com/js/api.js', () => {
      window.gapi.load('picker', () => {
        setGapiInited(true);
      });
    });

    loadScript('https://accounts.google.com/gsi/client', () => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (res: any) => {
          console.log("GIS global callback received:", res);
          if (res && res.access_token) {
            setAccessToken(res.access_token);
            if (resolveRef.current) resolveRef.current(res.access_token);
          } else {
            console.error("GIS Sign-in error object:", res);
            if (rejectRef.current) rejectRef.current(res);
          }
        },
        error_callback: (err: any) => {
          console.error("GIS Error callback fired:", err);
          alert("Google Sign-in system error: " + err.type + "\nNote: Brave Shields or Incognito mode might block Google cookies.");
          if (rejectRef.current) rejectRef.current(err);
        }
      });
      setTokenClient(client);
      setGisInited(true);
    });
  }, []);

  const login = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      console.log("Initiating login sequence...");
      if (!gisInited || !tokenClient) {
        alert("Google systems are still loading or blocked. Please refresh the page.");
        return reject("Not loaded");
      }
      
      resolveRef.current = resolve;
      rejectRef.current = reject;

      try {
        console.log("Requesting access token popup...");
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (e) {
        console.error("Popup blocked:", e);
        alert("Google Authentication was blocked by your browser settings.");
        reject(e);
      }
    });
  };

  return {
    isReady: gapiInited && gisInited,
    accessToken,
    login
  };
}
