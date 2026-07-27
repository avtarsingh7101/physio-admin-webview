import React, { useEffect, useRef } from 'react';
import { SafeAreaView, StatusBar, Vibration } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: true }) });
const API = 'https://tricityphysiohub.in';
export default function App() {
  const lastCount = useRef(0);
  useEffect(() => {
    Notifications.requestPermissionsAsync();
    const timer = setInterval(async () => {
      try { const r = await fetch(API + '/api/appointments'); const d = await r.json();
        if (d.success && d.appointments && lastCount.current > 0 && d.appointments.length > lastCount.current) {
          const a = d.appointments[0]; Vibration.vibrate([0,200,100,200]);
          await Notifications.scheduleNotificationAsync({ content: { title: 'New Appointment!', body: a.name + ' - ' + a.location }, trigger: null });
        } lastCount.current = d.appointments?.length || 0;
      } catch(e) {}
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  return (<SafeAreaView style={{flex:1,backgroundColor:'#1a365d'}}><StatusBar barStyle="light-content" backgroundColor="#1a365d" /><WebView source={{ uri: API + '/admin' }} style={{flex:1}} javaScriptEnabled domStorageEnabled /></SafeAreaView>);
}
