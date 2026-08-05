// ==UserScript==
// @name         Kompa - Base v8.9.0 (Police agrandie, Liens Markdown & Champs Discrets)
// @namespace    http://tampermonkey.net/
// @version      8.9.0
// @description  Filtrage dynamique, agenda OR, champs invisibles au survol, police 13px, support [mot](url)
// @match        https://app.kompa.pro/*
// @updateURL    https://raw.githubusercontent.com/d171666-hash/kompa/main/Kompa.user.js
// @downloadURL  https://raw.githubusercontent.com/d171666-hash/kompa/main/Kompa.user.js
// @grant        GM_xmlhttpRequest
// @connect      api.jsonbin.io
// ==/UserScript==

(function() {
    'use strict';

    // === GESTION DONNÉES JSONBIN ===
    const BIN_ID = '6a70b0cbda38895dfeb42e9e';
    const API_KEY = '$2a$10$7orDVqDxgul3ukG4RZ7BTOaGeCD0ES1b2dvzfm6wf/1TzOZPoDjb.';

    const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/gi;
    const RAW_URL_REGEX = /^(https?:\/\/[^\s]+)$/i;

    let storeData = { quotes: {}, invoices: {}, settings: {} };
    let isSaving = false;
    let saveTimeout = null;
    let sortAsc = true;
    let observer = null;

    let filterState = {
        cmd: false,
        plan: false,
        dispo: false
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // === CSS CENTRALISÉ ===
    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        table {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
        }

        .kompa-cell {
            vertical-align: middle !important;
            padding: 6px 8px !important;
            white-space: nowrap !important;
        }

        /* Couleurs des lignes selon statut */
        tr.kompa-status-ready { background-color: #dcfce7 !important; }    /* Vert saturé */
        tr.kompa-status-unsigned { background-color: #fca5a5 !important; } /* Rouge saturé */
        tr.kompa-status-unplanned { background-color: #fdba74 !important; }/* Orange saturé */
        tr.kompa-status-overdue { background-color: #fef9c3 !important; }  /* Jaune doux */

        /* Textarea par défaut : style discret / invisible, police agrandie à 13px */
        .kompa-textarea {
            font-size: 13px !important;
            padding: 3px 5px !important;
            border: 1px transparent !important;
            border-radius: 4px !important;
            resize: none !important;
            overflow: hidden !important;
            font-family: inherit !important;
            box-sizing: border-box !important;
            line-height: 1.3 !important;
            min-height: 26px !important;
            display: block !important;
            width: 100% !important;
            background-color: transparent !important;
            color: #0f172a !important;
            transition: all 0.15s ease;
            cursor: pointer;
        }

        .kompa-textarea:hover {
            border-color: #cbd5e1 !important;
            background-color: rgba(255, 255, 255, 0.5) !important;
        }

        /* Focus : vrai champ de saisie visible */
        .kompa-textarea:focus {
            outline: none !important;
            border: 1px solid #2563eb !important;
            background-color: #ffffff !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15) !important;
            cursor: text;
        }

        .kompa-url-link {
            font-size: 13px !important;
            color: #2563eb !important;
            text-decoration: underline !important;
            white-space: normal !important;
            word-break: break-all !important;
            cursor: pointer !important;
            display: inline-block;
            margin-top: 2px;
        }

        /* Champ Date discret par défaut, police 13px */
        .kompa-date-input {
            font-size: 13px !important;
            padding: 2px 4px !important;
            border: 1px transparent !important;
            border-radius: 4px !important;
            font-family: inherit !important;
            box-sizing: border-box !important;
            display: inline-block !important;
            width: 125px !important;
            background-color: transparent !important;
            color: #0f172a !important;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .kompa-date-input:hover {
            border-color: #94a3b8 !important;
            background-color: rgba(255, 255, 255, 0.5) !important;
        }

        .kompa-date-input:focus {
            outline: none !important;
            border: 1px solid #2563eb !important;
            background-color: #ffffff !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15) !important;
            cursor: text;
        }

        .col-delai-sortable { cursor: pointer !important; user-select: none; }
        .col-delai-sortable:hover { background-color: #f1f5f9; }

        .kompa-status-tracker {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            width: 100%;
            user-select: none;
        }
        .kompa-tracker-emojis {
            display: flex;
            justify-content: space-between;
            width: 70px;
            font-size: 13px;
        }
        .kompa-emoji-item {
            opacity: 0.25;
            filter: grayscale(100%);
            transition: all 0.2s ease;
        }
        .kompa-emoji-item.active {
            opacity: 1;
            filter: grayscale(0%);
            transform: scale(1.15);
        }
        .kompa-tracker-bar {
            display: flex;
            width: 70px;
            height: 5px;
            background: #e2e8f0;
            border-radius: 3px;
            overflow: hidden;
            gap: 2px;
        }
        .kompa-bar-segment {
            flex: 1;
            background: transparent;
            transition: background 0.2s ease;
        }
        
        .kompa-bar-segment.seg-cmd.active { background-color: #ef4444; }   /* Rouge */
        .kompa-bar-segment.seg-plan.active { background-color: #f97316; }  /* Orange */
        .kompa-bar-segment.seg-dispo.active { background-color: #eab308; } /* Jaune */

        .kompa-filter-group {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #ffffff;
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid #cbd5e1;
            font-size: 11px;
            user-select: none;
        }
        .kompa-filter-label {
            display: flex;
            align-items: center;
            gap: 3px;
            cursor: pointer;
            font-weight: 600;
        }
        .kompa-filter-label input {
            cursor: pointer;
            accent-color: #0284c7;
        }
    `;
    document.head.appendChild(styleSheet);

    function parseMarkdownLinks(text) {
        MARKDOWN_LINK_REGEX.lastIndex = 0;
        return escapeHtml(text).replace(MARKDOWN_LINK_REGEX, (match, linkText, url) => {
            const safeUrl = escapeHtml(url);
            return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="kompa-url-link">${linkText}</a>`;
        });
    }

    function createInteractiveField(value, placeholder, width, maxLength = 1000, onChange, isCalendarMode = false) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `position: relative; display: block; width: ${width};`;

        const txt = document.createElement('textarea');
        txt.className = 'kompa-textarea';
        txt.placeholder = placeholder || '';
        txt.value = value || '';
        txt.maxLength = maxLength;
        txt.rows = 1;

        const adjustHeight = () => {
            txt.style.height = 'auto';
            txt.style.height = (txt.scrollHeight) + 'px';
        };

        txt.addEventListener('input', adjustHeight);

        const displayContainer = document.createElement('div');
        displayContainer.style.cssText = 'font-size: 13px; display: none; line-height: 1.2; word-break: break-all; white-space: normal; user-select: none; padding: 3px 5px;';

        const updateDisplay = () => {
            const currentVal = txt.value.trim();

            if (!currentVal) {
                txt.style.display = 'block';
                displayContainer.style.display = 'none';
                adjustHeight();
                return;
            }

            displayContainer.innerHTML = '';

            if (isCalendarMode) {
                const formattedQuery = currentVal
                    .trim()
                    .split(/\s+/)
                    .map(term => encodeURIComponent(term))
                    .join('+OR+');

                const isAndroid = /Android/i.test(navigator.userAgent);
                const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

                const webCalUrl = `https://calendar.google.com/calendar/u/0/r/search?q=${formattedQuery}`;
                let appUrl = webCalUrl;

                if (isAndroid) {
                    appUrl = `intent://calendar.google.com/calendar/u/0/r/search?q=${formattedQuery}#Intent;scheme=https;package=com.google.android.calendar;end;`;
                } else if (isIOS) {
                    appUrl = `com.google.calendar://calendar/u/0/r/search?q=${formattedQuery}`;
                }

                const linkEl = document.createElement('a');
                linkEl.href = appUrl;
                linkEl.target = '_blank';
                linkEl.rel = 'noopener noreferrer';
                linkEl.className = 'kompa-url-link';
                linkEl.textContent = `📅 ${currentVal}`;

                displayContainer.appendChild(linkEl);
                txt.style.display = 'none';
                displayContainer.style.display = 'block';
                return;
            }

            if (MARKDOWN_LINK_REGEX.test(currentVal)) {
                displayContainer.innerHTML = parseMarkdownLinks(currentVal);
                txt.style.display = 'none';
                displayContainer.style.display = 'block';
            } else if (RAW_URL_REGEX.test(currentVal)) {
                const linkEl = document.createElement('a');
                linkEl.href = currentVal;
                linkEl.target = '_blank';
                linkEl.rel = 'noopener noreferrer';
                linkEl.className = 'kompa-url-link';
                linkEl.textContent = currentVal;

                displayContainer.appendChild(linkEl);
                txt.style.display = 'none';
                displayContainer.style.display = 'block';
            } else {
                txt.style.display = 'block';
                displayContainer.style.display = 'none';
                adjustHeight();
            }
        };

        txt.onblur = () => {
            onChange(txt.value);
            updateDisplay();
        };

        const enableEditMode = (e) => {
            e.preventDefault();
            e.stopPropagation();
            displayContainer.style.display = 'none';
            txt.style.display = 'block';
            adjustHeight();
            txt.focus();
        };

        displayContainer.addEventListener('dblclick', enableEditMode);

        wrapper.appendChild(txt);
        wrapper.appendChild(displayContainer);

        updateDisplay();
        setTimeout(adjustHeight, 0);

        return wrapper;
    }

    function createTH(text, className, width) {
        const th = document.createElement('th');
        th.className = className;
        th.innerText = text;
        th.style.cssText = `width: ${width}; padding: 6px 8px; font-weight: 600; text-align: left; vertical-align: middle;`;
        return th;
    }

    // === REQUÊTES SERVEUR JSONBIN ===
    function loadCloudData() {
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,
            headers: { "X-Master-Key": API_KEY },
            onload: function(response) {
                if (response.status === 200) {
                    const res = JSON.parse(response.responseText);
                    storeData = res.record || {};
                    if (!storeData.quotes) storeData.quotes = {};
                    if (!storeData.invoices) storeData.invoices = {};
                    if (!storeData.settings) storeData.settings = {};

                    processTable();
                }
            }
        });
    }

    function saveCloudData() {
        if (saveTimeout) clearTimeout(saveTimeout);

        saveTimeout = setTimeout(() => {
            if (isSaving) return;
            isSaving = true;
            GM_xmlhttpRequest({
                method: "PUT",
                url: `https://api.jsonbin.io/v3/b/${BIN_ID}`,
                headers: {
                    "Content-Type": "application/json",
                    "X-Master-Key": API_KEY
                },
                data: JSON.stringify(storeData),
                onload: function() { isSaving = false; },
                onerror: function() { isSaving = false; }
            });
        }, 1200);
    }

    function applyColumnVisibility() {
        const table = document.querySelector('table');
        if (!table) return;

        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        Array.from(headerRow.children).forEach((th, index) => {
            const colName = th.innerText.trim().replace(/[\n\r]+/g, ' ');

            if (!colName) {
                th.style.display = '';
                table.querySelectorAll('tbody tr').forEach(row => {
                    if (row.children[index]) {
                        row.children[index].style.display = '';
                    }
                });
                return;
            }

            const isVisible = storeData.settings[colName] !== false;
            th.style.display = isVisible ? '' : 'none';

            table.querySelectorAll('tbody tr').forEach(row => {
                if (row.children[index]) {
                    row.children[index].style.display = isVisible ? '' : 'none';
                }
            });
        });
    }

    function updateRowStatusUI(row, data) {
        const isCmd = Boolean(data.cmd);
        const isPlan = Boolean(data.plan);
        const isDispo = Boolean(data.dispo);

        row.dataset.isCmd = isCmd;
        row.dataset.isPlan = isPlan;
        row.dataset.isDispo = isDispo;

        const tracker = row.querySelector('.kompa-status-tracker');
        if (tracker) {
            const emCmd = tracker.querySelector('.em-cmd');
            const emPlan = tracker.querySelector('.em-plan');
            const emDispo = tracker.querySelector('.em-dispo');

            const segCmd = tracker.querySelector('.seg-cmd');
            const segPlan = tracker.querySelector('.seg-plan');
            const segDispo = tracker.querySelector('.seg-dispo');

            if (emCmd) emCmd.classList.toggle('active', isCmd);
            if (emPlan) emPlan.classList.toggle('active', isPlan);
            if (emDispo) emDispo.classList.toggle('active', isDispo);

            if (segCmd) segCmd.classList.toggle('active', isCmd);
            if (segPlan) segPlan.classList.toggle('active', isPlan);
            if (segDispo) segDispo.classList.toggle('active', isDispo);
        }

        row.classList.remove('kompa-status-ready', 'kompa-status-unsigned', 'kompa-status-unplanned', 'kompa-status-overdue');

        const isSigned = Array.from(row.querySelectorAll('td, span')).some(el => el.textContent.trim().toLowerCase() === 'signé');

        let isOverdue = false;
        if (data.delaiDate) {
            const today = new Date().toISOString().split('T')[0];
            if (data.delaiDate < today) {
                isOverdue = true;
            }
        }

        if (isCmd && isPlan && isDispo) {
            row.classList.add('kompa-status-ready');
        } else if (isSigned && !isCmd) {
            row.classList.add('kompa-status-unsigned');
        } else if (isSigned && isCmd && !isPlan) {
            row.classList.add('kompa-status-unplanned');
        } else if (isOverdue && !isDispo) {
            row.classList.add('kompa-status-overdue');
        }

        applyRowFilter(row);
    }

    function applyRowFilter(row) {
        const anyFilterActive = filterState.cmd || filterState.plan || filterState.dispo;

        if (!anyFilterActive) {
            row.style.display = '';
            return;
        }

        const isCmd = row.dataset.isCmd === 'true';
        const isPlan = row.dataset.isPlan === 'true';
        const isDispo = row.dataset.isDispo === 'true';

        let show = true;
        if (filterState.cmd && !isCmd) show = false;
        if (filterState.plan && !isPlan) show = false;
        if (filterState.dispo && !isDispo) show = false;

        row.style.display = show ? '' : 'none';
    }

    function applyAllFilters() {
        const table = document.querySelector('table');
        if (!table) return;

        table.querySelectorAll('tbody tr').forEach(row => {
            applyRowFilter(row);
        });
        renderControlBar(window.location.pathname.toLowerCase().endsWith('/quotes'));
    }

    function toggleModal(show) {
        let modal = document.getElementById('kompa-col-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'kompa-col-modal';
            modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); z-index: 999999; justify-content: center; align-items: center; padding: 15px; box-sizing: border-box;';

            const content = document.createElement('div');
            content.id = 'kompa-col-modal-content';
            content.style.cssText = 'background: #ffffff; border-radius: 12px; padding: 18px; width: 100%; max-width: 340px; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.3); box-sizing: border-box;';

            modal.appendChild(content);
            document.body.appendChild(modal);

            modal.onclick = (e) => {
                if (e.target === modal) modal.style.display = 'none';
            };
        }

        if (show) {
            renderModalContent(modal.querySelector('#kompa-col-modal-content'));
            modal.style.display = 'flex';
        } else {
            modal.style.display = 'none';
        }
    }

    function renderModalContent(container) {
        const table = document.querySelector('table');
        if (!table) return;

        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                <h3 style="margin:0; font-size: 15px; color: #0f172a;">Gestion des colonnes</h3>
                <button id="close-modal-btn" style="background: none; border: none; font-size: 20px; font-weight: bold; cursor: pointer; color: #64748b; padding: 0 5px;">✕</button>
            </div>
            <div id="checkbox-list" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 15px;"></div>
            <button id="reset-modal-btn" style="width: 100%; padding: 10px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer;">Tout réafficher</button>
        `;

        container.querySelector('#close-modal-btn').onclick = () => toggleModal(false);

        const list = container.querySelector('#checkbox-list');

        Array.from(headerRow.children).forEach(th => {
            const colName = th.innerText.trim().replace(/[\n\r]+/g, ' ');
            if (!colName) return;

            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: 10px; font-size: 14px; color: #1e293b; cursor: pointer; user-select: none;';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = storeData.settings[colName] !== false;
            chk.style.cssText = 'width: 20px; height: 20px; cursor: pointer; accent-color: #2563eb;';

            chk.onchange = () => {
                storeData.settings[colName] = chk.checked;
                saveCloudData();
                applyColumnVisibility();
            };

            label.appendChild(chk);
            label.appendChild(document.createTextNode(colName));
            list.appendChild(label);
        });

        container.querySelector('#reset-modal-btn').onclick = () => {
            storeData.settings = {};
            saveCloudData();
            applyColumnVisibility();
            renderModalContent(container);
        };
    }

    function renderControlBar(isQuotePage) {
        const table = document.querySelector('table');
        if (!table) return;

        let controlBanner = document.getElementById('kompa-custom-controls');
        if (!controlBanner) {
            controlBanner = document.createElement('div');
            controlBanner.id = 'kompa-custom-controls';
            controlBanner.style.cssText = 'padding: 6px 10px; margin: 8px 0; background: #f0f9ff; border-radius: 6px; font-weight: 600; display: flex; align-items: center; justify-content: flex-end; font-size: 11px; border: 1px solid #bae6fd; flex-wrap: wrap; gap: 6px; box-sizing: border-box; color: #0369a1; width: 100%;';

            const searchInput = document.querySelector('input[placeholder*="Rechercher"]');
            let filterBlock = searchInput ? searchInput.closest('div[class*="flex"], div[class*="grid"]') : null;

            if (filterBlock && filterBlock.parentNode) {
                filterBlock.parentNode.insertBefore(controlBanner, filterBlock.nextSibling);
            } else {
                table.parentElement.insertBefore(controlBanner, table);
            }
        }

        controlBanner.innerHTML = `<div id="btn-container" style="display:flex; gap:8px; align-items:center;"></div>`;

        const btnContainer = controlBanner.querySelector('#btn-container');

        if (isQuotePage && !btnContainer.querySelector('.kompa-filter-group')) {
            const filterGroup = document.createElement('div');
            filterGroup.className = 'kompa-filter-group';
            filterGroup.innerHTML = `
                <span style="color:#64748b; font-size:10px; margin-right:2px;">Filtres:</span>
                <label class="kompa-filter-label" title="Filtrer si commande passée">
                    <input type="checkbox" id="flt-cmd" ${filterState.cmd ? 'checked' : ''}> 🛒
                </label>
                <label class="kompa-filter-label" title="Filtrer si chantier planifié">
                    <input type="checkbox" id="flt-plan" ${filterState.plan ? 'checked' : ''}> 📅
                </label>
                <label class="kompa-filter-label" title="Filtrer si matériel dispo au dépôt">
                    <input type="checkbox" id="flt-dispo" ${filterState.dispo ? 'checked' : ''}> 🏚️
                </label>
            `;

            filterGroup.querySelector('#flt-cmd').onchange = (e) => {
                filterState.cmd = e.target.checked;
                applyAllFilters();
            };
            filterGroup.querySelector('#flt-plan').onchange = (e) => {
                filterState.plan = e.target.checked;
                applyAllFilters();
            };
            filterGroup.querySelector('#flt-dispo').onchange = (e) => {
                filterState.dispo = e.target.checked;
                applyAllFilters();
            };

            btnContainer.appendChild(filterGroup);
        }

        const btn = document.createElement('button');
        btn.id = 'kompa-col-btn';
        btn.innerText = 'Colonnes';
        btn.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: none; background: #0284c7; font-size: 11px; font-weight: bold; color: #ffffff; cursor: pointer; white-space: nowrap;';
        btn.onclick = () => toggleModal(true);

        btnContainer.appendChild(btn);
    }

    function sortTableByDate() {
        const tbody = document.querySelector('table tbody');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((rowA, rowB) => {
            const valA = rowA.querySelector('.inp-delai-date')?.value || '';
            const valB = rowB.querySelector('.inp-delai-date')?.value || '';

            if (!valA && !valB) return 0;
            if (!valA) return 1;
            if (!valB) return -1;

            return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });

        sortAsc = !sortAsc;

        const thDelai = document.querySelector('th.col-delai');
        if (thDelai) thDelai.innerText = `Délai Dispo ${sortAsc ? '▲' : '▼'}`;

        rows.forEach(row => tbody.appendChild(row));
    }

    function processTable() {
        if (observer) observer.disconnect();

        const table = document.querySelector('table');
        if (!table) {
            reconnectObserver();
            return;
        }

        const headerRow = table.querySelector('thead tr');
        if (!headerRow) {
            reconnectObserver();
            return;
        }

        const currentPath = window.location.pathname.toLowerCase();
        const isInvoicePage = currentPath.endsWith('/invoices') || currentPath.endsWith('/invoices/');
        const isQuotePage = currentPath.endsWith('/quotes') || currentPath.endsWith('/quotes/');

        if (!isInvoicePage && !isQuotePage) {
            reconnectObserver();
            return;
        }

        if (isQuotePage && !headerRow.querySelector('.col-status')) {
            headerRow.insertBefore(createTH('État', 'col-status', '95px'), headerRow.children[0]);

            const actionsTh = headerRow.children[headerRow.children.length - 1];

            headerRow.insertBefore(createTH('Cmd Passée & Réf', 'col-cmd', '160px'), actionsTh);
            headerRow.insertBefore(createTH('Planifié & Agenda', 'col-plan', '160px'), actionsTh);

            const thDelai = createTH('Délai Dispo ⇅', 'col-delai col-delai-sortable', '160px');
            thDelai.title = 'Cliquer pour trier par date';
            thDelai.onclick = sortTableByDate;
            headerRow.insertBefore(thDelai, actionsTh);

            headerRow.insertBefore(createTH('Note', 'col-note', '150px'), actionsTh);

        } else if (isInvoicePage && !headerRow.querySelector('.col-sav')) {
            const actionsTh = headerRow.children[headerRow.children.length - 1];
            headerRow.insertBefore(createTH('Note SAV', 'col-sav', '180px'), actionsTh);
        }

        table.querySelectorAll('tbody tr').forEach(row => {
            const idMatch = row.innerText.match(/(D|F|PR)[-\d]+(-AV\d+)?/i);
            if (!idMatch) return;

            const itemId = idMatch[0];
            const lastTdIndex = row.children.length - 1;
            const actionsTd = row.children[lastTdIndex];

            if (isQuotePage && !row.querySelector('.cell-status')) {
                if (!storeData.quotes[itemId]) storeData.quotes[itemId] = { cmd: false, ref: '', plan: false, calQuery: '', note: '', delaiDate: '', delaiTxt: '', dispo: false };
                const data = storeData.quotes[itemId];

                const tdStatus = document.createElement('td');
                tdStatus.className = 'cell-status kompa-cell';
                tdStatus.innerHTML = `
                    <div class="kompa-status-tracker">
                        <div class="kompa-tracker-emojis">
                            <span class="kompa-emoji-item em-cmd" title="Commande passée">🛒</span>
                            <span class="kompa-emoji-item em-plan" title="Chantier planifié">📅</span>
                            <span class="kompa-emoji-item em-dispo" title="Matériel dispo au dépôt">🏚️</span>
                        </div>
                        <div class="kompa-tracker-bar">
                            <div class="kompa-bar-segment seg-cmd"></div>
                            <div class="kompa-bar-segment seg-plan"></div>
                            <div class="kompa-bar-segment seg-dispo"></div>
                        </div>
                    </div>
                `;
                row.insertBefore(tdStatus, row.children[0]);

                const tdCmd = document.createElement('td');
                tdCmd.className = 'cell-cmd kompa-cell';
                const chkCmd = document.createElement('input');
                chkCmd.type = 'checkbox';
                chkCmd.checked = data.cmd || false;
                chkCmd.style.cssText = 'vertical-align: middle; margin-right: 4px;';
                chkCmd.onchange = () => {
                    data.cmd = chkCmd.checked;
                    updateRowStatusUI(row, data);
                    renderControlBar(isQuotePage);
                    saveCloudData();
                };
                const flexCmd = document.createElement('div');
                flexCmd.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                flexCmd.appendChild(chkCmd);
                flexCmd.appendChild(createInteractiveField(data.ref, 'Réf cmd...', '120px', 1000, (val) => {
                    data.ref = val;
                    saveCloudData();
                }));
                tdCmd.appendChild(flexCmd);
                row.insertBefore(tdCmd, actionsTd);

                const tdPlan = document.createElement('td');
                tdPlan.className = 'cell-plan kompa-cell';
                const chkPlan = document.createElement('input');
                chkPlan.type = 'checkbox';
                chkPlan.checked = data.plan || false;
                chkPlan.style.cssText = 'vertical-align: middle; margin-right: 4px;';
                chkPlan.onchange = () => {
                    data.plan = chkPlan.checked;
                    updateRowStatusUI(row, data);
                    renderControlBar(isQuotePage);
                    saveCloudData();
                };
                const flexPlan = document.createElement('div');
                flexPlan.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                flexPlan.appendChild(chkPlan);
                flexPlan.appendChild(createInteractiveField(data.calQuery || '', 'Recherche Agenda...', '120px', 1000, (val) => {
                    data.calQuery = val;
                    saveCloudData();
                }, true));
                tdPlan.appendChild(flexPlan);
                row.insertBefore(tdPlan, actionsTd);

                const tdDelai = document.createElement('td');
                tdDelai.className = 'cell-delai kompa-cell';
                const chkDispo = document.createElement('input');
                chkDispo.type = 'checkbox';
                chkDispo.checked = data.dispo || false;
                chkDispo.style.cssText = 'vertical-align: middle; margin-right: 4px;';
                chkDispo.onchange = () => {
                    data.dispo = chkDispo.checked;
                    updateRowStatusUI(row, data);
                    renderControlBar(isQuotePage);
                    saveCloudData();
                };
                const inputDate = document.createElement('input');
                inputDate.type = 'date';
                inputDate.className = 'kompa-date-input inp-delai-date';
                inputDate.value = data.delaiDate || '';
                inputDate.onchange = () => {
                    data.delaiDate = inputDate.value;
                    updateRowStatusUI(row, data);
                    saveCloudData();
                };
                const dispoWrapper = document.createElement('div');
                dispoWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';
                dispoWrapper.appendChild(chkDispo);
                dispoWrapper.appendChild(inputDate);
                tdDelai.appendChild(dispoWrapper);
                row.insertBefore(tdDelai, actionsTd);

                const tdNote = document.createElement('td');
                tdNote.className = 'cell-note kompa-cell';
                tdNote.appendChild(createInteractiveField(data.note, 'Note...', '120px', 1000, (val) => {
                    data.note = val;
                    saveCloudData();
                }));
                row.insertBefore(tdNote, actionsTd);

                updateRowStatusUI(row, data);

            } else if (isInvoicePage && !row.querySelector('.cell-sav')) {
                if (!storeData.invoices[itemId]) storeData.invoices[itemId] = { sav: '' };
                const data = storeData.invoices[itemId];

                const tdSav = document.createElement('td');
                tdSav.className = 'cell-sav kompa-cell';
                tdSav.appendChild(createInteractiveField(data.sav, 'Note SAV...', '140px', 1000, (val) => {
                    data.sav = val;
                    saveCloudData();
                }));
                row.insertBefore(tdSav, actionsTd);
            }
        });

        applyColumnVisibility();
        renderControlBar(isQuotePage);
        reconnectObserver();
    }

    function reconnectObserver() {
        if (!observer) {
            observer = new MutationObserver(() => {
                processTable();
            });
        }
        observer.observe(document.body, { childList: true, subtree: true });
    }

    loadCloudData();
})();
