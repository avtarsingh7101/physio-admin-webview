import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, Vibration, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

const API = 'https://tricityphysiohub.in';

export default function App() {
  const webRef = useRef(null);
  const lastCount = useRef(0);
  const [savedPass, setSavedPass] = useState('131313');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await SecureStore.getItemAsync('admin_pass');
        if (p) setSavedPass(p);
      } catch (e) {}
      setReady(true);
    })();
    setupPush();
    startPolling();
  }, []);

  const setupPush = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      const token = await Notifications.getExpoPushTokenAsync({ projectId: '8e57bbf8-0538-43b0-864b-4fe93bab8d46' });
      await fetch(API + '/api/register-push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.data, platform: Platform.OS }),
      });
    } catch (e) {}
  };

  const startPolling = () => {
    setInterval(async () => {
      try {
        const r = await fetch(API + '/api/appointments');
        const d = await r.json();
        if (d.success && d.appointments) {
          if (lastCount.current > 0 && d.appointments.length > lastCount.current) {
            const a = d.appointments[0];
            Vibration.vibrate([0, 200, 100, 200]);
            await Notifications.scheduleNotificationAsync({
              content: { title: 'New Appointment!', body: a.name + ' - ' + a.location },
              trigger: null,
            });
          }
          lastCount.current = d.appointments.length;
        }
      } catch (e) {}
    }, 10000);
  };

  const handleMessage = async (msg) => {
    try {
      const { type, password } = JSON.parse(msg.nativeEvent.data);
      if (type === 'save_pass' && password) {
        await SecureStore.setItemAsync('admin_pass', password);
      }
    } catch (e) {}
  };

  if (!ready) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a365d' }}>
      <StatusBar barStyle="light-content" backgroundColor="#1a365d" />
    </SafeAreaView>
  );

  const autoLoginJS = `
    document.addEventListener('DOMContentLoaded', function() {
      const check = setInterval(() => {
        const pass = document.getElementById('adminPassword');
        const btn = document.querySelector('#loginForm button');
        if (pass && btn) {
          pass.value = '${savedPass}';
          btn.click();
          clearInterval(check);
        }
      }, 200);
    });
    // Save password after successful login
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      return origFetch.apply(this, arguments).then(r => {
        if (typeof url === 'string' && url.includes('/api/admin/password') && opts?.method === 'POST') {
          r.clone().json().then(d => {
            if (d.success) {
              window.ReactNativeWebView.postMessage(JSON.stringify({type:'save_pass', password: '${savedPass}'}));
            }
          });
        }
        return r;
      });
    };
  `;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a365d' }}>
      <StatusBar barStyle="light-content" backgroundColor="#1a365d" />
      <WebView
        ref={webRef}
        source={{ uri: API + '/admin' }}
        style={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        injectedJavaScript={autoLoginJS}
      />
    </SafeAreaView>
  );
}
