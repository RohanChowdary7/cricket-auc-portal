<div align="center">
  <img src="https://img.shields.io/badge/Status-Live_Beta-success?style=for-the-badge" alt="Status" />
  <img src="https://img.shields.io/badge/Platform-Web-blue?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/Socket.io-Realtime-orange?style=for-the-badge" alt="Realtime" />
  
  <br>
  <h1>🎙️ GCL AUCTION 2026 PRO</h1>
  <p><b>A highly customizable, realtime, cinematic mock auction portal.</b></p>
  <br>
</div>

Welcome to the **GCL Auction Portal**, a powerful web-based application designed to host live, synchronized, sports-style player auctions. With a focus on a premium user experience and flawless multi-screen synchronization via WebSockets, this tool is perfect for fantasy leagues, esports teams, and mock bidding events.

---

## ✨ Features Breakdown

### 🎨 1. Premium Broadcast UI & UX
*   **Cinematic Design:** Built with modern CSS (Glassmorphism, Neon glows, Custom Google Fonts like 'Bebas Neue' and 'Rajdhani'). 
*   **Live Player Cards:** Stunning player displays with automatic tier-based color gradients (`Tier 1` to `Tier 5`) based on player ratings.
*   **Immersive Intros:** Fully animated countdown overlays.
    *   **🤖 AI Master Mode Intro**: Pulse-pounding 60-second animated sequence that builds suspense with 'Starting Soon' glitch-text animations before revealing the first player.
    *   **🏅 Cinematic Manual Intro**: Features dynamic video backgrounds (`intro.mp4`) and synchronized custom BGM (`intro.mp3`) with deep nautical/gold aesthetics.
*   **Realtime Bidding Feed:** A live news-ticker style feed flashes up showing team logos, amounts, and live time extensions.

### ⚡ 2. Real-Time Synchronization (Socket.io)
*   No more page refreshes! The entire state of the auction is managed by a Node.js server.
*   All client browsers (Admins, Bidders, and Spectators) reflect the exact same state within milliseconds.
*   "Live Sync Dots" verify connection health directly in the navbar.

### 🛡️ 3. Robust Role-Based Access Control
*   **👑 Admin Role:** Complete control. Can start/pause/resume auctions, switch pools, place manual bids, undo mistakes, change rules, and manage the session.
*   **💼 Team/Bidder Role:** Only sees the live auction floor and their squad UI. Can click the bid button dynamically based on their remaining budget. Strictly blocked from navigating to Admin/Analytic areas via strict client-side routing protection.
*   **👀 Spectator Mode:** Can only watch the live state. No bidding or admin access.

### 🤖 4. "Autopilot AI" vs Manual Mode
*   **AI Autopilot:** The server takes the wheel! Automatically iterates through standard or specific pools, skips already 'Sold' players, runs the 60s transitions seamlessly between major tiers, and controls the auction pace.
*   **Manual Control:** The Admin manually picks the next player pool and dictates exactly when the player comes to the floor.

### ⚙️ 5. Advanced Session Management 
*   **Database Free Base:** Runs off of lightweight in-memory JSON state and local storage, ensuring lightning-fast performance.
*   **Import/Export Magic:** Can instantly load demo CSV data, or export the entire current live session into a shareable `auction_state.json` file.
*   **State Recovery:** Refresh the page or lose internet connection? No problem. The server pushes the exact live state back to the client the second they reconnect.

---

## 🚀 Installation & Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/stuckedonsixty9/GCL-AUCTION-APP.git
   cd GCL-AUCTION-APP
   ```

2. **Install Dependencies**
   The application requires Node.js and Socket.io.
   ```bash
   npm install express socket.io
   ```

3. **Start the Server**
   ```bash
   node server.js
   # or
   npm start
   ```

4. **Access the Portal**
   Open your browser and navigate to:
   *   Local Network: `http://localhost:3000`
   *   *Ensure port `3000` is open on your firewall if hosting for friends on the same WiFi.*

---

## 🎬 Customizing Your Intros

You can enhance the auction experience by adding custom media files directly into the root folder!

*   **Custom BGM (Audio):** Place an `intro.mp3` file in the root directory. This will automatically fade in and play during the 60-second intro sequence for both AI and Manual modes.
*   **Custom Video Background:** Place an `intro.mp4` file in the root directory. This will play responsively behind the 60-second countdown specifically during the **Manual Mode** intro.

---

## 🎮 How to Play

### As the Admin (The Auctioneer)
1.  Log in using the Admin credentials (Default: `admin` / `password`).
2.  Head to the **Players** tab and load the `test_players.csv` demo file to populate the database.
3.  Go to the **Teams** tab and set up your bidding franchises.
4.  Navigate to the **Auction** tab. 
5.  Click **"▶ Start Auction"**. Choose either **Manual Mode** for full control or **AI Master Mode** to let the system generate the queue.

### As a Bidder (The Franchise Owner)
1.  Log in using your Team name from the dropdown. No password required by default.
2.  Wait for the Admin to start the auction.
3.  When a player is on the block, rapidly hit the `BID` button to place your stakes! Be fully aware of your Remaining Purse limit displayed at the top right.

---

<p align="center">
  <i>Developed for intense, flawless mock-auction experiences. Enjoy the bidding war! 🏏💰</i>
</p>
