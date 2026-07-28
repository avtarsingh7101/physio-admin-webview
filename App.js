import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  Vibration,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

// ── Foreground handler ──
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const API = 'https://tricityphysiohub.in';
const CHANNEL_ID = 'appointments';
const BG_TASK = 'physio-admin-bg-poll';
const SS_LAST_ID = 'last_appointment_id';

// ── Background fetch task ──
// Runs every ~15min (Android minimum) even when app is killed/swiped away.
// Shares state with foreground via SecureStore so no double-notifications.
TaskManager.defineTask(BG_TASK, async () => {
  try {
    const r = await fetch(API + '/api/appointments');
    const d = await r.json();
    if (!d.success || !d.appointments || d.appointments.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const latest = d.appointments[0];
    const lastId = await SecureStore.getItemAsync(SS_LAST_ID);

    // First run — just store the ID, don't notify
    if (!lastId) {
      await SecureStore.setItemAsync(SS_LAST_ID, String(latest.id || latest.name));
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const currentId = String(latest.id || latest.name);
    if (currentId !== lastId) {
      // New appointment found
      await SecureStore.setItemAsync(SS_LAST_ID, currentId);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'New Appointment!',
          body: latest.name + ' - ' + (latest.location || 'Clinic'),
          data: { screen: 'admin', appointmentId: latest.id },
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
        },
        trigger: null,
      });

      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export default function App() {
  const webRef = useRef(null);
  const lastIdRef = useRef(null);
  const [pass, setPass] = useState('131313');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await SecureStore.getItemAsync('admin_pass');
        if (p) setPass(p);
      } catch {
        // use default
      }
      setReady(true);
    })();

    // ── Android notification channel (Android 8+ MANDATORY) ──
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Appointment Alerts',
        description: 'New patient appointment notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#1a365d',
        sound: 'default',
        // Show on lock screen + heads-up popup
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
      }).catch(() => {});
    }

    // ── Register push token ──
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
        // non-critical
      }
    })();

    // ── Seed SecureStore with current count on first launch ──
    (async () => {
      try {
        const r = await fetch(API + '/api/appointments');
        const d = await r.json();
        if (d.success && d.appointments && d.appointments.length > 0) {
          const latest = d.appointments[0];
          const stored = await SecureStore.getItemAsync(SS_LAST_ID);
          if (!stored) {
            await SecureStore.setItemAsync(
              SS_LAST_ID,
              String(latest.id || latest.name),
            );
          }
          lastIdRef.current = stored || String(latest.id || latest.name);
        }
      } catch {
        // ignore
      }
    })();

    // ── Register background fetch ──
    BackgroundFetch.registerTaskAsync(BG_TASK, {
      minimumInterval: 15 * 60, // 15 min (Android floor)
      stopOnTerminate: false,
      startOnBoot: true,
    }).catch(() => {});

    // ── Foreground polling every 10s ──
    const timer = setInterval(async () => {
      try {
        const r = await fetch(API + '/api/appointments');
        const d = await r.json();
        if (!d.success || !d.appointments) return;

        if (d.appointments.length > 0) {
          const latest = d.appointments[0];
          const currentId = String(latest.id || latest.name);

          // First poll — init ref
          if (!lastIdRef.current) {
            lastIdRef.current = currentId;
            return;
          }

          if (currentId !== lastIdRef.current) {
            lastIdRef.current = currentId;
            await SecureStore.setItemAsync(SS_LAST_ID, currentId);

            Vibration.vibrate([0, 200, 100, 200]);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'New Appointment!',
                body: latest.name + ' - ' + (latest.location || 'Clinic'),
                data: { screen: 'admin', appointmentId: latest.id },
                ...(Platform.OS === 'android'
                  ? { channelId: CHANNEL_ID }
                  : {}),
              },
              trigger: null,
            });
          }
        }
      } catch {
        // next tick
      }
    }, 10000);

    // ── MIUI / Redmi permission guide (once per device) ──
    if (Platform.OS === 'android') {
      SecureStore.getItemAsync('miui_guide_shown').then((shown) => {
        if (!shown) {
          setTimeout(() => {
            Alert.alert(
              '📱 Redmi / MIUI Setup',
              'For reliable background notifications on Redmi phones:\n\n' +
              '1️⃣  Autostart\n' +
              '   Settings → Apps → Manage apps\n' +
              '   → PhysioHub Admin → Autostart → ON\n\n' +
              '2️⃣  Battery\n' +
              '   Settings → Apps → Manage apps\n' +
              '   → PhysioHub Admin → Battery saver\n' +
              '   → No restrictions\n\n' +
              '3️⃣  Lock in Recents\n' +
              '   Open recent apps (swipe up/hold ☰)\n' +
              '   → Tap & hold PhysioHub Admin card\n' +
              '   → 🔒 Lock icon\n\n' +
              '4️⃣  Notifications\n' +
              '   Settings → Notifications → App notifications\n' +
              '   → PhysioHub Admin → Allow all\n\n' +
              'Open Settings now?',
              [
                { text: 'Later', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => {
                    Linking.openSettings();
                    SecureStore.setItemAsync('miui_guide_shown', '1');
                  },
                },
              ],
            );
            SecureStore.setItemAsync('miui_guide_shown', '1');
          }, 4000);
        }
      });
    }

    return () => {
      clearInterval(timer);
      BackgroundFetch.unregisterTaskAsync(BG_TASK).catch(() => {});
    };
  }, []);

  // WebView message handler (password save)
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

  // Auto-login script
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
