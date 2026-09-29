// Firebase app/database/auth setup — the one place credentials live. Every
// other module reaches the database through `database`/`wordsRef` exported
// here rather than initializing its own connection.
import { firebaseConfig } from '../../firebase-config.js';

export const firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
export const database = firebase.database(firebaseApp);
export const auth = firebase.auth();
export const japanRef = database.ref('languages/japan');
export const wordsRef = japanRef.child('words');
export const updateJapanData = (updates) => database.ref().update(
	Object.fromEntries(Object.entries(updates).map(([path, value]) => [`languages/japan/${path}`, value]))
);
