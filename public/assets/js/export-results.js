/**
 * Shared election results exporter (CSV, PDF/Print, TXT) for admin pages.
 * Expects API_URL and (optionally) NACOME_POSITIONS from main.js.
 */
(function (global) {
    'use strict';

    function escHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escCsv(val) {
        const s = String(val == null ? '' : val);
        if (/[",\r\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function getPositionTitleMap() {
        const map = new Map();
        const order = [];
        if (typeof NACOME_POSITIONS !== 'undefined' && Array.isArray(NACOME_POSITIONS)) {
            NACOME_POSITIONS.forEach((p) => {
                map.set(p.id, p.title);
                order.push(p.id);
            });
        }
        return { map, order };
    }

    function formatPositionFallback(posId) {
        return String(posId || 'Unknown Position')
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    async function fetchExportPayload() {
        const base = (typeof API_URL !== 'undefined' && API_URL) ? API_URL : '/api';

        const [statsRes, candRes, votersRes] = await Promise.all([
            fetch(`${base}/stats`, { cache: 'no-store' }),
            fetch(`${base}/candidates`, { cache: 'no-store' }),
            fetch(`${base}/stats/all-voters`, { cache: 'no-store' }).catch(() => null)
        ]);

        const stats = statsRes && statsRes.ok ? await statsRes.json() : {};
        const candidates = candRes && candRes.ok ? await candRes.json() : [];
        const voters = votersRes && votersRes.ok ? await votersRes.json() : [];

        const { map: titleMap, order: knownOrder } = getPositionTitleMap();
        const grouped = new Map();

        candidates.forEach((c) => {
            const posId = c.position || 'unassigned';
            if (!grouped.has(posId)) {
                grouped.set(posId, []);
            }
            grouped.get(posId).push({
                id: c.id,
                name: c.name || 'Unnamed Candidate',
                matricNo: c.matricNo || '-',
                level: c.level || '-',
                college: c.college || '-',
                dept: c.dept || '-',
                status: c.status || 'approved',
                votes: Number(c.votes || 0)
            });
        });

        // Order positions: known NACOME_POSITIONS first, then any extras alphabetically
        const orderedIds = [
            ...knownOrder.filter((id) => grouped.has(id)),
            ...[...grouped.keys()].filter((id) => !knownOrder.includes(id)).sort()
        ];

        const positions = orderedIds.map((posId) => {
            const list = grouped.get(posId).slice().sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
            const totalPositionVotes = list.reduce((sum, c) => sum + c.votes, 0);
            const topVotes = list.length > 0 ? list[0].votes : 0;
            const topCount = topVotes > 0 ? list.filter((c) => c.votes === topVotes).length : 0;

            const ranked = list.map((c, idx) => {
                const pct = totalPositionVotes > 0 ? ((c.votes / totalPositionVotes) * 100).toFixed(1) : '0.0';
                let outcome = 'Contested';
                if (totalPositionVotes === 0) {
                    outcome = 'No Votes';
                } else if (c.votes === topVotes) {
                    outcome = topCount > 1 ? 'Tied for 1st' : 'Winner / Leading';
                }
                return {
                    ...c,
                    rank: idx + 1,
                    pct,
                    outcome
                };
            });

            return {
                id: posId,
                title: titleMap.get(posId) || formatPositionFallback(posId),
                totalVotes: totalPositionVotes,
                candidates: ranked
            };
        });

        return {
            generatedAt: new Date(),
            stats: {
                totalVoters: Number(stats.totalVoters || voters.length || 0),
                totalVotesCast: Number(stats.totalRegisteredVotes || 0),
                totalStudents: Number(stats.totalStudents || stats.totalRegNos || 0),
                totalCandidates: Number(stats.totalCandidates || candidates.length || 0)
            },
            positions,
            voters: Array.isArray(voters) ? voters : []
        };
    }

    function triggerDownload(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportTxt(data) {
        const lines = [];
        lines.push('NACOME 2026 ELECTION RESULTS (MOUAU • CEET • COMPUTER ENGINEERING)');
        lines.push(`Generated: ${data.generatedAt.toLocaleString()}`);
        lines.push('='.repeat(72));
        lines.push(`Total Voters Participated : ${data.stats.totalVoters}`);
        lines.push(`Total Votes Cast          : ${data.stats.totalVotesCast}`);
        lines.push(`Registered Candidates     : ${data.stats.totalCandidates}`);
        lines.push(`Positions Contested       : ${data.positions.length}`);
        lines.push('');

        if (data.positions.length === 0) {
            lines.push('No candidate results found.');
        } else {
            data.positions.forEach((pos) => {
                lines.push('-'.repeat(72));
                lines.push(`${pos.title.toUpperCase()}  (Total Votes: ${pos.totalVotes})`);
                lines.push('-'.repeat(72));
                pos.candidates.forEach((c) => {
                    const tag = c.outcome === 'Winner / Leading'
                        ? ' [WINNER]'
                        : c.outcome === 'Tied for 1st'
                            ? ' [TIED]'
                            : '';
                    lines.push(
                        `  ${c.rank}. ${c.name} (${c.matricNo}) — ${c.votes} votes (${c.pct}%)${tag}`
                    );
                });
                lines.push('');
            });
        }

        if (data.voters.length > 0) {
            lines.push('='.repeat(72));
            lines.push(`ACCREDITED VOTER ROLL (${data.voters.length})`);
            lines.push('-'.repeat(72));
            data.voters.forEach((v, i) => {
                const when = v.votedAt ? new Date(v.votedAt).toLocaleString() : '-';
                lines.push(`${i + 1}. ${v.name || '-'} (${v.matricNo || '-'}) - ${when}`);
            });
        }

        triggerDownload(lines.join('\r\n'), 'NACOME_Election_Results_2026.txt', 'text/plain;charset=utf-8');
    }

    function exportCsv(data) {
        const rows = [];
        rows.push(['NACOME 2026 Election Results']);
        rows.push(['Generated', data.generatedAt.toLocaleString()]);
        rows.push(['Total Voters', data.stats.totalVoters]);
        rows.push(['Total Votes Cast', data.stats.totalVotesCast]);
        rows.push(['Total Candidates', data.stats.totalCandidates]);
        rows.push([]);
        rows.push(['Position', 'Rank', 'Candidate Name', 'Matric No', 'Level', 'Department', 'Votes', 'Share (%)', 'Status']);

        data.positions.forEach((pos) => {
            pos.candidates.forEach((c) => {
                rows.push([
                    pos.title,
                    c.rank,
                    c.name,
                    c.matricNo,
                    c.level,
                    c.dept,
                    c.votes,
                    `${c.pct}%`,
                    c.outcome
                ]);
            });
        });

        if (data.voters.length > 0) {
            rows.push([]);
            rows.push(['Accredited Voter Roll']);
            rows.push(['#', 'Voter Name', 'Matric No', 'Voted At']);
            data.voters.forEach((v, i) => {
                rows.push([
                    i + 1,
                    v.name || '-',
                    v.matricNo || '-',
                    v.votedAt ? new Date(v.votedAt).toLocaleString() : '-'
                ]);
            });
        }

        const csvContent = '\uFEFF' + rows.map((r) => r.map(escCsv).join(',')).join('\r\n');
        triggerDownload(csvContent, 'NACOME_Election_Results_2026.csv', 'text/csv;charset=utf-8');
    }

    function exportPdf(data) {
        const positionBlocks = data.positions.length === 0
            ? '<p class="empty">No candidate results available.</p>'
            : data.positions.map((pos) => {
                const bodyRows = pos.candidates.map((c) => {
                    const badgeClass = c.outcome === 'Winner / Leading'
                        ? 'badge-win'
                        : c.outcome === 'Tied for 1st'
                            ? 'badge-tie'
                            : 'badge-normal';
                    return `
                        <tr>
                            <td class="num">${c.rank}</td>
                            <td><strong>${escHtml(c.name)}</strong></td>
                            <td>${escHtml(c.matricNo)}</td>
                            <td class="num"><strong>${c.votes}</strong></td>
                            <td class="num">${c.pct}%</td>
                            <td><span class="badge ${badgeClass}">${escHtml(c.outcome)}</span></td>
                        </tr>
                    `;
                }).join('');

                return `
                    <section class="pos-block">
                        <div class="pos-head">
                            <h3>${escHtml(pos.title)}</h3>
                            <span>Total Votes: <strong>${pos.totalVotes}</strong></span>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:48px">#</th>
                                    <th>Candidate</th>
                                    <th>Matric No</th>
                                    <th style="width:80px;text-align:right">Votes</th>
                                    <th style="width:80px;text-align:right">Share</th>
                                    <th style="width:130px">Status</th>
                                </tr>
                            </thead>
                            <tbody>${bodyRows}</tbody>
                        </table>
                    </section>
                `;
            }).join('');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>NACOME 2026 Election Results</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; line-height: 1.45; }
    .header { border-bottom: 3px solid #0b6623; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header h1 { margin: 0 0 4px 0; font-size: 18px; color: #0b6623; }
    .header p { margin: 0; color: #475569; font-size: 11px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
    .kpi .label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: bold; }
    .kpi .val { font-size: 18px; font-weight: bold; color: #0f172a; margin-top: 2px; }
    .pos-block { margin-bottom: 18px; page-break-inside: avoid; }
    .pos-head { display: flex; justify-content: space-between; align-items: center; background: #ecfdf5; border-left: 4px solid #0b6623; padding: 6px 10px; margin-bottom: 6px; }
    .pos-head h3 { margin: 0; font-size: 13px; color: #064e1b; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; color: #334155; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: bold; }
    .badge-win { background: #dcfce7; color: #166534; }
    .badge-tie { background: #fef9c3; color: #854d0e; }
    .badge-normal { background: #f1f5f9; color: #475569; }
    .signatures { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; page-break-inside: avoid; }
    .sig-line { border-top: 1px solid #334155; padding-top: 6px; font-size: 11px; color: #334155; }
    @media print {
        body { margin: 12mm; }
    }
</style>
</head>
<body>
    <div class="header">
        <div>
            <h1>NACOME 2026 Election Official Results</h1>
            <p>Department of Computer Engineering, CEET • Michael Okpara University of Agriculture, Umudike</p>
        </div>
        <p>Generated: ${escHtml(data.generatedAt.toLocaleString())}</p>
    </div>

    <div class="kpis">
        <div class="kpi"><div class="label">Total Voters</div><div class="val">${data.stats.totalVoters}</div></div>
        <div class="kpi"><div class="label">Total Votes Cast</div><div class="val">${data.stats.totalVotesCast}</div></div>
        <div class="kpi"><div class="label">Candidates</div><div class="val">${data.stats.totalCandidates}</div></div>
        <div class="kpi"><div class="label">Positions</div><div class="val">${data.positions.length}</div></div>
    </div>

    ${positionBlocks}

    <div class="signatures">
        <div class="sig-line">Electoral Committee Chairman — Signature &amp; Date</div>
        <div class="sig-line">Chief Returning Officer — Signature &amp; Date</div>
    </div>
</body>
</html>`;

        // Use a hidden iframe so printing/Save-as-PDF works even if popups are blocked
        const existing = document.getElementById('export-print-frame');
        if (existing) existing.remove();

        const iframe = document.createElement('iframe');
        iframe.id = 'export-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();

        iframe.onload = () => {
            setTimeout(() => {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            }, 150);
        };
    }

    async function runExport(format, triggerBtn) {
        const originalHtml = triggerBtn ? triggerBtn.innerHTML : null;
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Exporting...';
        }
        try {
            const payload = await fetchExportPayload();
            if (format === 'csv') exportCsv(payload);
            else if (format === 'pdf') exportPdf(payload);
            else exportTxt(payload);
        } catch (err) {
            console.error('Export failed:', err);
            alert('Failed to export election results: ' + (err.message || 'Unknown error'));
        } finally {
            if (triggerBtn && originalHtml !== null) {
                triggerBtn.disabled = false;
                triggerBtn.innerHTML = originalHtml;
            }
        }
    }

    function initExportMenu() {
        const btn = document.getElementById('export-btn');
        const menu = document.getElementById('export-menu');
        if (!btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        });

        menu.querySelectorAll('[data-export-format]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const fmt = item.getAttribute('data-export-format');
                menu.classList.add('hidden');
                runExport(fmt, btn);
            });
        });

        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.add('hidden');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExportMenu);
    } else {
        initExportMenu();
    }

    global.ResultsExporter = {
        export: (format) => runExport(format, document.getElementById('export-btn'))
    };
})(window);
