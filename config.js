<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyDp-yVYrMzF1a84i-3_GcBlIsAk_rg1Zdk",
    authDomain: "toko-dani-77a00.firebaseapp.com",
    projectId: "toko-dani-77a00",
    storageBucket: "toko-dani-77a00.firebasestorage.app",
    messagingSenderId: "450873334306",
    appId: "1:450873334306:web:58eff76efbe18159d1487b",
    measurementId: "G-S9H7QL11LT"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>