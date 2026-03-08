import os
import re

files = [
    r"c:\Users\mannu\Desktop\Latest auction app\script.js",
    r"c:\Users\mannu\Desktop\Latest auction app\public\script.js"
]

for fpath in files:
    with open(fpath, "r", encoding="utf-8") as f:
        code = f.read()

    # We need to add an auto-download feature directly into endAuction
    # Find the endAuction function block and inject our logic.
    
    inject_str = """
    // Ensure nav and controls are accessible for admin
    if (currentUser && currentUser.role === "admin") {
        document.querySelectorAll(".admin-only").forEach(function (el) { el.classList.remove("hidden"); });
    }
    
    // Auto-trigger download for bidders specifically when auction ends natively
    if (currentUser && currentUser.role === "team") {
        setTimeout(function() {
            try {
                downloadSquadTxt(currentUser.teamId);
                toast("Auction Ended. Your squad report is downloading automatically.", "success", 6000);
            } catch(e) {}
        }, 3000);
    }
"""

    # Look for the spot in endAuction
    code = re.sub(
        r'    // Ensure nav and controls are accessible for admin\n    if \(currentUser && currentUser\.role === "admin"\) \{\n[ \t]*document\.querySelectorAll\("\.admin-only"\)\.forEach\(function \(el\) \{ el\.classList\.remove\("hidden"\); \}\);\n    \}',
        inject_str,
        code
    )

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(code)

print("Injected auto-download")
