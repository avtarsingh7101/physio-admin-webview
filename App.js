import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, Vibration, Platform, Alert } from 'react-native';
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
  const [pass, setPass] = useState('131313');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await SecureStore.getItemAsync('admin_pass');
        if (p) setPass(p);
      } catch (e) {}
      setReady(true);
    })();

    // Request notification permission (required for Android 13+)
    Notifications.requestPermissionsAsync();

    // Register push token
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          const token = await Notifications.getExpoPushTokenAsync({ projectId: '8e57bbf8-0538-43b0-864b-4fe93bab8d46' });
          await fetch(API + '/api/register-push', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.data, platform: Platform.OS }),
          });
        }
      } catch (e) {}
    })();

    // Poll for new appointments
    const timer = setInterval(async () => {
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

    // Show background permission hint (Android)
    if (Platform.OS === 'android') {
      setTimeout(() => {
        Alert.alert(
          'Background Alerts',
          'To receive appointment alerts when app is closed:\n\n' +
          'Go to: Settings → Apps → PhysioHub Admin → Battery → "Unrestricted"\n\n' +
          'This allows notifications even when the app is in background.',
          [{ text: 'OK', style: 'default' }]
        );
      }, 3000);
    }

    return () => clearInterval(timer);
  }, []);

  // Handle messages from WebView (password save)
  const handleMessage = async (msg) => {
    try {
      const data = JSON.parse(msg.nativeEvent.data);
      if (data.type === 'save_pass' && data.password) {
        await SecureStore.setItemAsync('admin_pass', data.password);
        setPass(data.password);
      }
    } catch (e) {}
  };

  // Auto-login script injected into WebView
  const autoLoginJS = `
    (function() {
      var check = setInterval(function() {
        var p = document.getElementById('adminPassword');
        var b = document.querySelector('#loginForm button');
        if (p && b) {
          p.value = '${pass}';
          b.click();
          clearInterval(check);
        }
      }, 100);
      window.addEventListener('load', function() {
        setTimeout(function() {
          var p = document.getElementById('adminPassword');
          var b = document.querySelector('#loginForm button');
          if (p && b) { p.value = '${pass}'; b.click(); }
        }, 300);
      });
      // Save password on change
      var orig = window.fetch;
      window.fetch = function(u, o) {
        return orig.apply(this, arguments).then(function(r) {
          if (typeof u === 'string' && u.indexOf('/api/admin/password') >= 0 && o && o.method === 'POST') {
            r.clone().json().then(function(d) {
              if (d.success) {
                window.ReactNativeWebView.postMessage(JSON.stringify({type:'save_pass', password: '${pass}'}));
              }
            });
          }
          return r;
        });
      };
    })();
  `;

  if (!ready) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a365d' }}>
      <StatusBar barStyle="light-content" backgroundColor="#1a365d" />
    </SafeAreaView>
  );

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
        onError={() => {}}
      />
    </SafeAreaView>
  );
}
