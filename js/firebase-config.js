// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDvZl_abJrH1MfLpC5B9OGzoIA_j1ZrNpw",
    authDomain: "diplomatic-strategy-game.firebaseapp.com",
    databaseURL: "https://diplomatic-strategy-game-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "diplomatic-strategy-game",
    storageBucket: "diplomatic-strategy-game.firebasestorage.app",
    messagingSenderId: "587820211997",
    appId: "1:587820211997:web:1dbba7828dfae4ad5c0bf4"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Database references
const countriesRef = database.ref('countries');
const gameStateRef = database.ref('gameState');
const tradesRef = database.ref('trades');