import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StatusBar, Vibration, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

// Foreground notification handler — shows alert, plays sound, sets badge
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const API = 'https://tricityphysiohub.in';
const CHANNEL_ID = 'appointments';

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
      } catch {
        // use default password
      }
      setReady(true);
    })();

    // ── Android notification channel (REQUIRED for Android 8+) ──
    // Without HIGH importance, Android silently drops all notifications.
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Appointment Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#1a365d',
        sound: 'default',
      }).catch(() => {});
    }

    // ── Register push token (Expo Push → FCM → device) ──
    (async () => {
      try {
        let { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          const result = await Notifications.requestPermissionsAsync();
          status = result.status;
        }
        if (status === 'granted') {
          const token = await Notifications.getExpoPushTokenAsync({
            projectId: '8e57bbf8-0538-43b0-864b-4fe93bab8d46',
          });
          await fetch(API + '/api/register-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.data, platform: Platform.OS }),
          });
        }
      } catch {
        // Push registration is non-critical
      }
    })();

    // ── Poll for new appointments every 10s (foreground only) ──
    // Android freezes JS timers when app is backgrounded.
    // For background delivery, backend must send push via Expo Push API.
    const timer = setInterval(async () => {
      try {
        const r = await fetch(API + '/api/appointments');
        const d = await r.json();
        if (d.success && d.appointments) {
          if (lastCount.current > 0 && d.appointments.length > lastCount.current) {
            const a = d.appointments[0];
            Vibration.vibrate([0, 200, 100, 200]);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'New Appointment!',
                body: a.name + ' - ' + a.location,
                data: { screen: 'admin' },
                // Link to HIGH importance channel so Android shows it
                ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
              },
              trigger: null,
            });
          }
          lastCount.current = d.appointments.length;
        }
      } catch {
        // Poll error — next tick
      }
    }, 10000);

    // ── Background permission hint (once per device) ──
    if (Platform.OS === 'android') {
      SecureStore.getItemAsync('bg_hint_shown').then((shown) => {
        if (!shown) {
          setTimeout(() => {
            Alert.alert(
              'Background Alerts',
              'To get appointment alerts when app is closed:\n\n' +
              'Settings → Apps → PhysioHub Admin → Battery → "Unrestricted"\n\n' +
              'This lets notifications reach you even in background.',
              [
                {
                  text: 'Got it',
                  style: 'default',
                  onPress: () => SecureStore.setItemAsync('bg_hint_shown', '1'),
                },
              ]
            );
          }, 3000);
        }
      });
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
    } catch {
      // ignore
    }
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

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#1a365d' }}>
        <StatusBar barStyle="light-content" backgroundColor="#1a365d" />
      </SafeAreaView>
    );
  }

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
