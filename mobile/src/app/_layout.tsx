import Head from 'expo-router/head';import {Stack} from 'expo-router';import {StatusBar} from 'expo-status-bar';
export default function Layout(){return <><Head><title>TEF法语学习</title><meta name="theme-color" content="#2159B8"/></Head><StatusBar style="dark"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:'#F7F9FC'}}}/></>;}
