import re

with open('c:\\Users\\user_pc\\Desktop\\ABSU\\public\\super-admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Positions to generate
positions = [
    ('President', 'president'),
    ('Vice-President', 'vice-president'),
    ('Secretary-General', 'secretary-general'),
    ('Assistant Secretary-General', 'assistant-secretary-general'),
    ('Treasurer', 'treasurer'),
    ('Financial Secretary', 'financial-secretary'),
    ('Public Relations Officer', 'pro'),
    ('Director Of Welfare', 'director-of-welfare'),
    ('Director of Sports', 'director-of-sports'),
    ('Director of Socials', 'director-of-socials')
]

def generate_selects(prefix, bg_class):
    html = ""
    for title, key in positions:
        html += f"""<!-- {title} -->
<div class="{bg_class} p-4 rounded-xl border border-slate-200 dark:border-slate-700">
<label class="block text-xs font-bold text-primary uppercase tracking-wider mb-2">{title}</label>
<select id="{prefix}-{key}" required class="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary/20">
<option value="">-- Select candidate --</option>
</select>
</div>

"""
    return html.strip()

# Replace Manual Vote Selects
mv_html = generate_selects('mv', 'bg-white dark:bg-slate-800')
# We need to find the block from <!-- President --> to the end of <!-- PRO --> div
content = re.sub(r'<!-- President -->(.*?)</select>\n</div>', mv_html, content, count=1, flags=re.DOTALL)

# Replace Bulk Vote Selects (which doesn't have required attribute)
def generate_bv_selects(prefix, bg_class):
    html = ""
    for title, key in positions:
        html += f"""<!-- {title} -->
<div class="{bg_class} p-4 rounded-xl border border-slate-200 dark:border-slate-700">
<label class="block text-xs font-bold text-primary uppercase tracking-wider mb-2">{title}</label>
<select id="{prefix}-{key}" class="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary/20">
<option value="">-- Select candidate --</option>
</select>
</div>

"""
    return html.strip()

bv_html = generate_bv_selects('bv', 'bg-slate-50 dark:bg-slate-800')
# Replace second occurrence
content = re.sub(r'<!-- President -->(.*?)</select>\n</div>', bv_html, content, count=1, flags=re.DOTALL)

# Replace JavaScript positions object (manual vote load)
js_pos_str = "    const positions = {\n" + ",\n".join([f"        '{key}': 'mv-{key}'" for _, key in positions]) + "\n    };"
content = re.sub(r'const positions = \{.*?\};', js_pos_str, content, count=1, flags=re.DOTALL)

# Replace defaultCandidates (for manual vote)
js_def_str = "    const defaultCandidates = {\n" + ",\n".join([f"        '{key}': []" for _, key in positions]) + "\n    };"
content = re.sub(r'const defaultCandidates = \{.*?\};', js_def_str, content, count=1, flags=re.DOTALL)

# Replace votes object in manual vote submit
js_votes_mv_str = "    const votes = {\n" + ",\n".join([f"        '{key}': document.getElementById('mv-{key}').value" for _, key in positions]) + "\n    };"
content = re.sub(r'const votes = \{.*?\n.*?president: document.getElementById\(\'mv-president\'\).value,.*?\};', js_votes_mv_str, content, count=1, flags=re.DOTALL)

# Replace JavaScript positions object (bulk vote load)
js_pos_bv_str = "    const positions = {\n" + ",\n".join([f"        '{key}': 'bv-{key}'" for _, key in positions]) + "\n    };"
content = re.sub(r'const positions = \{.*?\};', js_pos_bv_str, content, count=1, flags=re.DOTALL)

# Replace defaultCandidates (for bulk vote)
content = re.sub(r'const defaultCandidates = \{.*?\};', js_def_str, content, count=1, flags=re.DOTALL)

# Replace votes object in bulk vote submit
js_votes_bv_str = "    const votes = {\n" + ",\n".join([f"        '{key}': document.getElementById('bv-{key}').value" for _, key in positions]) + "\n    };"
content = re.sub(r'const votes = \{.*?\n.*?president: document.getElementById\(\'bv-president\'\).value,.*?\};', js_votes_bv_str, content, count=1, flags=re.DOTALL)

with open('c:\\Users\\user_pc\\Desktop\\ABSU\\public\\super-admin.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("super-admin.html modified successfully")
