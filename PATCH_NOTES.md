# GCL Auction App - Patch Notes

## Latest Update (Commit: eb0d562 - 1 Mar 2026)

### Bug Fixes - Event Handling & Modal Issues
- **Modal Close Buttons (X)** - Fixed close buttons not working on bidder side without refresh
- **Cancel Button** - Fixed cancel button not closing modals properly
- **Navigation Issue** - Fixed modal closing when clicking inside modal content (dropdowns, inputs)
- **Event Delegation** - Added robust event handlers using event delegation for:
  - Modal close buttons (X) and Cancel buttons
  - Navigation links (Players, Teams, Admin, etc.)
  - Admin buttons (Add Player, Save Player, Import, Save Team)
- **Event Propagation** - Added stopPropagation inside modals to prevent unintended navigation when clicking form elements

---

## Previous Update (Commit: dcf2a5a - 1 Mar 2026)

### New Features
- **Bowling Archetype Options Updated** - Added new bowling archetype options: New Ball, Experimenter, Metronomic, Enforcer, Strike, Part Timer, Powerplay

### Bug Fixes
- **AllRounder Card Layout** - Fixed layout wrapping issue - bowling stats no longer shift down
- **Country Flag Badge** - Added country flag badge to top-left corner of player cards
- **Auction End Sync** - Fixed auction end synchronization for all connected clients; endAuction now runs on state sync when auction has already ended
- **Country Flag Input** - Added padding for country flag input field, flag emoji support in forms, and flag preview functionality
- **Dropdown Visibility** - Removed white backgrounds from dropdown options for better text visibility
- **AllRounder Display** - Fixed card alignment for AllRounder players; circular rating now displays centered properly
- **Bowler Display** - Fixed bowling hand display for Bowlers; corrected sold/unsold stamp logic
- **UI Glow Effects** - Added visual glow effects for better visual feedback
- **Bidding System** - Bidders list now freezes properly after auction ends; admin freeze post-auction works correctly
- **Going Overlays** - Fixed going overlays display issues

### Style Updates
- Updated CSS for country flags
- Added summary message styling
- Enhanced padding and visual polish across the UI

---

## Earlier Update (Commit: efc94c7 - 28 Feb 2026)

### Admin & UI Fixes
- **Quick Sell/Skip Removed** - These buttons are now completely removed from admin panel
- **Analytics Hidden** - Analytics nav link hidden for bidders (admin-only)

### Real-Time Sync Fixes
- **Unsold Players Tag** - Fixed unsold players showing "Upcoming" instead of "Unsold in this auction"
  - Root cause: Server wasn't setting `p.isUnsold = true` on player object
  - Now properly shows "Unsold in this auction" tag on player cards
- **Sold Players Tag** - Shows "Sold in this auction" properly
- **Player Photo Updates** - Added cache-busting to force refresh when new player appears

### Timer Fixes
- Timer resets to **25 seconds** (not 30s) when bid is placed at Going Once/Twice/Last Call (≤18 seconds)
- Timer circle syncs properly with actual remaining time
- Going Once/Twice/Last Call indicators work correctly

### Auto-Sync Features
- Bidders now request state from server every 10 seconds
- Auction history syncs in real-time without page refresh
- News ticker auto-updates every 5 seconds

### News Ticker
- Shows Hinglish headlines with team owner names
- No repeat functionality
- Neon border colors cycling

---

## Earlier Update (Commit: 20d22a6)

This workspace is actually a backup taken at commit `20d22a6`. The changes introduced in that commit were primarily housekeeping and removal of rarely‑used admin controls:

* **Quick sell and skip removed** – buttons in the admin panel were commented out/hidden and corresponding socket handlers turned into no‑ops. This prevents accidental forced sales and simplifies the auction flow. Stubs remain in server logs for compatibility.
* Minor client/server cleanup around the above features.

The fixes listed in the latest update (efc94c7) build on 20d22a6; refer to that section for additional real‑time sync and timer enhancements.

---

## Previous Updates

### Timer Enhancements (Earlier)
- Going Once/Twice/Last Call text in timer display
- Timer empty when reaches 0
- Timer synced with "Going" overlays

### News Ticker (Earlier)
- Neon lighting on border
- Speed reduced from 20s to 40s for smooth scrolling
- Fixed blinking issue

### SOLD/UNSOLD Stamp (Earlier)
- Fixed to appear on top of player photo
- Proper positioning

---

## Known Fixes Applied
1. Timer reset on bid (25s at Going stages) ✓
2. Unsold tag now showing properly ✓
3. Quick Sell/Skip completely removed ✓
4. Analytics hidden for bidders ✓
5. Player photo cache-busting ✓
6. Real-time sync every 10s for bidders ✓
7. News ticker with Hinglish headlines ✓

---

## Backup
- Latest backup: `cric-auc-backup-20260228.zip` (Desktop)
