import os
import re

file_path = r"c:\Users\mannu\Desktop\Latest auction app\script.js"

with open(file_path, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Remove variables
code = re.sub(r'var _priorityNews = \[\];\n', '', code)
code = re.sub(r'var rotation = 0; // Global rotation counter for news ticker\n', '', code)

# 2. Remove socket UI events for banter and nextplayer
code = re.sub(r'        socket\.on\("ui:banter", function \(data\) \{[\s\S]*?        \}\);\n', '', code)
code = re.sub(r'        socket\.on\("ui:nextplayer", function \(data\) \{[\s\S]*?        \}\);\n', '', code)

# 3. Remove "if (newsTickerVisible) updateNewsTicker();" and variations
code = re.sub(r'[ \t]*if \(newsTickerVisible\) updateNewsTicker\(\);\n', '', code)
code = re.sub(r'[ \t]*if \(!newsTickerVisible\) toggleNewsTicker\(\);\n', '', code)
code = re.sub(r'[ \t]*if \(newsTickerVisible\) \{ try \{ updateNewsTicker\(\); \} catch \(e\) \{.*?\} \}\n', '', code)
code = re.sub(r'[ \t]*if \(newsTickerVisible\) \{ try \{ updateNewsTicker\(\); \} catch \(e\) \{\} \}\n', '', code)

# 4. Remove automatic toggles in various places
code = re.sub(r'    // AUTO-ON NEWS TICKER FOR EVERYONE[\s\S]*?        toggleNewsTicker\(\);\n    \}\n', '', code)
code = re.sub(r'    // Spectator Sync Fix: Auto-enable ticker when auction is live[\s\S]*?    \}\n', '', code)

# 5. Remove triggerBanter calls
code = re.sub(r'[ \t]*if \(data\.player && data\.team\) triggerBanter\(data\.player, data\.team, data\.price\);\n', '', code)
code = re.sub(r'        // TRIGGER FUNNY BANTER[\s\S]*?        if \(socket\) socket\.emit\("admin:banter", \{ p: p, buyer: t, price: price \}\);\n', '', code)

# 6. Remove UI removal roles for banter
code = re.sub(r'    document\.getElementById\("banterOverlay"\)\?\.classList\.remove\("admin-only"\);\n', '', code)

# 7. Remove big functions: triggerBanter and its helper
code = re.sub(r'function triggerBanter\(p, buyer, price\) \{[\s\S]*?function sequenceNextPlayerAnnouncement', 'function sequenceNextPlayerAnnouncement', code)
code = re.sub(r'function pickDiverseIdx\(cat, length\) \{[\s\S]*?\}\n\n', '', code)

# 8. Remove big ticker section: ADVANCED BREAKING NEWS TICKER up to FEATURE 4
code = re.sub(r'// ============================================================\n//  ADVANCED BREAKING NEWS TICKER[\s\S]*?var _lastTickerBid = 0;\n+', '', code)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(code)

print("Done script.js")

# Do the same for public/script.js
file_path_pub = r"c:\Users\mannu\Desktop\Latest auction app\public\script.js"

with open(file_path_pub, "w", encoding="utf-8") as f:
    f.write(code)

print("Done public/script.js")
