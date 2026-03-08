import os
import re

files = [
    r"c:\Users\mannu\Desktop\Latest auction app\script.js",
    r"c:\Users\mannu\Desktop\Latest auction app\public\script.js"
]

for fpath in files:
    with open(fpath, "r", encoding="utf-8") as f:
        code = f.read()

    inject_str = """
    var downloadBtnHtml = '';
    if (currentUser && currentUser.role === "admin") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadAllSquadsTxt()" style="margin-left:8px;">📥 Download All Squads</button>';
    } else if (currentUser && currentUser.role === "team") {
        downloadBtnHtml = '<button class="btn btn-success" onclick="downloadSquadTxt(\\'' + currentUser.teamId + '\\')" style="margin-left:8px;">📥 Download My Squad</button>';
    }

    html += '<div class="end-actions">' +
        '<button class="btn btn-info" onclick="currentSquadCardIndex=0; showSquadCard(teams[0].id)">📇 View Squad Cards</button>' +
        downloadBtnHtml +
        '<p style="margin-top:15px; font-size:0.85rem; color:var(--text2)">Full analytics available in the Analytics tab.</p>' +
        '</div></div>';
"""

    code = re.sub(
        r"    html \+= '<div class=\"end-actions\">' \+\n        '<button class=\"btn btn-info\" onclick=\"currentSquadCardIndex=0; showSquadCard\(teams\[0\]\.id\)\">📇 View Squad Cards</button>' \+\n        '<p style=\"margin-top:15px; font-size:0\.85rem; color:var\(--text2\)\">Full analytics available in the Analytics tab\.</p>' \+\n        '</div></div>';",
        inject_str,
        code
    )

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(code)

print("Injected UI code")
