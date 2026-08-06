let user = null;

(async () => {
    try {
        const response = await fetch('/api/auth/me');
        if (response.status === 401) {
            console.warn('[Auth Check] Unauthorized: Redirecting to login...');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
            return;
        }
        const data = await response.json();
        if (!data.success || !data.user || data.user.role !== 'admin') {
            console.warn('[Auth Check] Access Denied or Session Stale. Redirecting to login...');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
            return;
        }
        
        // Sync user object
        user = data.user;
        localStorage.setItem('user', JSON.stringify(user));
        
        // Initialize Charts and start live updates
        initCharts();
        setInterval(() => {
            if (telemetryChartInstance) {
                packetsReceivedThisMinute = 0;
                telemetryHistory.push(0);
                telemetryHistory.shift();
                telemetryChartInstance.data.datasets[0].data = telemetryHistory;
                telemetryChartInstance.update();
            }
        }, 60000);
        
        // Load Dashboard
        loadDashboard();
    } catch (e) {
        console.error('[Auth Check] Error validating session:', e);
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    }
})();

function logout() {
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

let dashboardCache = null;
let currentViewUserId = null;
let currentViewSettings = null;

let telemetryChartInstance = null;
let statusChartInstance = null;
let packetsReceivedThisMinute = 0;
let telemetryHistory = [12, 19, 15, 8, 14, 20, 24, 18, 22, 28];
let telemetryLabels = ['-9m', '-8m', '-7m', '-6m', '-5m', '-4m', '-3m', '-2m', '-1m', 'Now'];

function initCharts() {
    const statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
        statusChartInstance = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Idle', 'Halt', 'Offline'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: ['#ff3b70', '#ffab00', '#ff3d00', '#94a3b8'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#2b354e',
                            font: { family: 'Outfit', size: 10, weight: '600' }
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    const telCtx = document.getElementById('telemetryChart');
    if (telCtx) {
        telemetryChartInstance = new Chart(telCtx, {
            type: 'line',
            data: {
                labels: telemetryLabels,
                datasets: [{
                    label: 'Packets',
                    data: telemetryHistory,
                    borderColor: '#ff3b70',
                    backgroundColor: 'rgba(255, 59, 112, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff3b70'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(0,0,0,0.03)' },
                        ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                    }
                }
            }
        });
    }
}

// -----------------------------------------------------------------------
// Modal Controls
// -----------------------------------------------------------------------
function showAddCustomerModal() { document.getElementById('addCustomerModal').classList.add('active'); }
function closeAddCustomerModal() { document.getElementById('addCustomerModal').classList.remove('active'); }

// ── Credentials Modal ──
let _passwordRevealed = false;

async function showCredentialsModal(userId) {
    document.getElementById('credUserId').value = userId;
    document.getElementById('credUsername').innerText = '…loading…';
    document.getElementById('credPassword').innerText = '••••••••';
    document.getElementById('credPassword').dataset.plain = '';
    document.getElementById('newPasswordInput').value = '';
    _passwordRevealed = false;
    document.getElementById('btn-reveal').innerHTML = '<i class="fa-regular fa-eye"></i>';
    document.getElementById('credentialsModal').classList.add('active');

    try {
        const res = await fetch(`/api/admin/get-credentials/${userId}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('credUsername').innerText = data.username;
            document.getElementById('credPassword').dataset.plain = data.password;
            document.getElementById('credPassword').innerText = '••••••••';
        } else {
            document.getElementById('credUsername').innerText = 'Error';
        }
    } catch(e) {
        document.getElementById('credUsername').innerText = 'Failed to load';
    }
}

function closeCredentialsModal() {
    document.getElementById('credentialsModal').classList.remove('active');
}

function togglePasswordReveal() {
    const el = document.getElementById('credPassword');
    const btn = document.getElementById('btn-reveal');
    _passwordRevealed = !_passwordRevealed;
    if (_passwordRevealed) {
        el.innerText = el.dataset.plain || '(empty)';
        btn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
        btn.classList.add('copied');
    } else {
        el.innerText = '••••••••';
        btn.innerHTML = '<i class="fa-regular fa-eye"></i>';
        btn.classList.remove('copied');
    }
}

function copyToClipboard(elementId, btnId, usePlain = false) {
    const el = document.getElementById(elementId);
    const text = usePlain ? (el.dataset.plain || el.innerText) : el.innerText;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById(btnId);
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            btn.classList.remove('copied');
        }, 1800);
    });
}

function copyAllCredentials() {
    const username = document.getElementById('credUsername').innerText;
    const password = document.getElementById('credPassword').dataset.plain || '';
    const text = `Aleanvition Login\nUsername: ${username}\nPassword: ${password}\nPortal: ${window.location.origin}`;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('#credentialsModal .modal-btn');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
}

async function submitResetPassword() {
    const userId = document.getElementById('credUserId').value;
    const newPassword = document.getElementById('newPasswordInput').value.trim();
    if (!newPassword) return alert('Enter a new password.');
    const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, newPassword })
    });
    const result = await res.json();
    if (result.success) {
        document.getElementById('credPassword').dataset.plain = newPassword;
        if (_passwordRevealed) document.getElementById('credPassword').innerText = newPassword;
        document.getElementById('newPasswordInput').value = '';
        const btn = document.querySelector('#credentialsModal [onclick="submitResetPassword()"]');
        const orig = btn.innerText;
        btn.innerText = '✓ Done';
        setTimeout(() => { btn.innerText = orig; }, 1800);
    } else {
        alert('Reset failed.');
    }
}

function exportAllCustomers() {
    window.location.href = `/api/export/devices?userId=admin&role=admin`;
}

function switchPage(pageId, pushToHistory = true) {
    const pages = ['dashboard', 'devices', 'customers', 'requests', 'payments', 'terminal'];
    if (pushToHistory) {
        history.pushState({ page: pageId }, '', `#${pageId}`);
    }
    pages.forEach(p => {
        const pageEl = document.getElementById(`page-${p}`);
        const btnEl = document.getElementById(`nav-btn-${p}`);
        if (pageEl) pageEl.classList.remove('active');
        if (btnEl) btnEl.classList.remove('active');
    });
    
    const targetPage = document.getElementById(`page-${pageId}`);
    const targetBtn = document.getElementById(`nav-btn-${pageId}`);
    if (targetPage) targetPage.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
    
    if (pageId !== 'customers') {
        closeCustomerDetail(false);
    }
}

window.addEventListener('popstate', (e) => {
    if (e.state && e.state.modal === 'customer') {
        openCustomerDetail(e.state.userId, e.state.username, false);
    } else if (e.state && e.state.page) {
        switchPage(e.state.page, false);
    } else {
        switchPage('dashboard', false);
    }
});

let currentGlobalDeviceFilter = 'all';

function applyGlobalDeviceFilter() {
    const filterSelect = document.getElementById('globalDeviceFilter');
    if (filterSelect) {
        renderAllDevices(filterSelect.value);
    }
}

function renderAllDevices(filter = 'all') {
    currentGlobalDeviceFilter = filter;
    const filterSelect = document.getElementById('globalDeviceFilter');
    if (filterSelect) filterSelect.value = filter;

    const tbody = document.getElementById('globalDevicesTableBody');
    if (!tbody) return;

    if (!dashboardCache || !dashboardCache.allDevices) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No devices found.</td></tr>';
        return;
    }

    const lastSeen = dashboardCache.lastSeen || {};
    const now = Date.now();

    const filteredDevices = dashboardCache.allDevices.filter(d => {
        const ls = lastSeen[d.imei] || {};
        const isOnline = ls.timestamp && (now - new Date(ls.timestamp)) < 120000;
        let s = 'offline';
        if (isOnline) {
            s = ls.status || 'halt';
        }

        if (filter === 'active' && s !== 'running') return false;
        if (filter === 'idle' && s !== 'idle') return false;
        if (filter === 'halt' && s !== 'halt') return false;
        if (filter === 'offline' && s !== 'offline') return false;
        return true;
    });

    const countEl = document.getElementById('globalDevicesCount');
    if (countEl) countEl.innerText = `(${filteredDevices.length})`;

    if (filteredDevices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No devices match this filter.</td></tr>';
        return;
    }

    tbody.innerHTML = filteredDevices.map(d => {
        const ls = lastSeen[d.imei] || {};
        const isOnline = ls.timestamp && (now - new Date(ls.timestamp)) < 120000;
        let statusText = 'Offline';
        let statusColor = '#94a3b8';
        if (isOnline) {
            const s = ls.status || 'halt';
            if (s === 'running') { statusText = 'Active'; statusColor = 'var(--accent)'; }
            else if (s === 'idle') { statusText = 'Idle'; statusColor = 'var(--amber)'; }
            else { statusText = 'Halt'; statusColor = 'var(--red)'; }
        }

        const customer = dashboardCache.customers.find(c => c.id === d.ownerId);
        const ownerName = customer ? (customer.name || customer.username) : 'Unknown';

        return `
            <tr>
                <td>
                    <div style="font-weight:700; color:var(--text);">${d.name || 'Unnamed Device'}</div>
                    <div style="font-size:10px; color:var(--muted); font-family:monospace;">IMEI: ${d.imei}</div>
                </td>
                <td>
                    <div style="color:var(--text);">${ownerName}</div>
                    <div style="font-size:10px; color:var(--muted); font-family:monospace;">ID: ${d.ownerId}</div>
                </td>
                <td>
                    <span class="badge" style="background:rgba(255,255,255,0.03); color:${statusColor}; border-color:${statusColor}44">
                        ${statusText}
                    </span>
                </td>
                <td style="font-size:11px;">
                    <div>Speed: <span style="font-weight:700; color:var(--text);">${ls.speed || 0}</span> km/h</div>
                    <div style="color:var(--muted);">Odo: ${ls.odometer ? ls.odometer.toFixed(1) : '0.0'} km</div>
                    <div style="color:${d.expirationDate && new Date(d.expirationDate) > new Date() ? 'var(--success, #00e676)' : 'var(--red)'}; font-weight: 600; margin-top: 2px;">
                        Validity: ${d.expirationDate ? Math.ceil((new Date(d.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) + ' days' : 'N/A'}
                    </div>
                </td>
                <td style="font-size:11px; font-family:monospace; color:var(--muted);">
                    ${ls.latitude ? ls.latitude.toFixed(4) : '0'}, ${ls.longitude ? ls.longitude.toFixed(4) : '0'}
                </td>
                <td style="text-align:right;">
                    <div class="actions-cell">
                        <button class="icon-btn" onclick="downloadDeviceData('${d.imei}')" title="Download History">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="icon-btn" onclick="showDeviceValidityModal('${d.imei}')" title="Recharge Device" style="color:var(--green); border-color:var(--green-dim);">
                            <i class="fa-solid fa-bolt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function showDeviceValidityModal(imei) {
    document.getElementById('valImei').value = imei;
    document.getElementById('valDeviceExtraDays').value = 30;
    document.getElementById('deviceValidityModal').classList.add('active');
}
function closeDeviceValidityModal() { document.getElementById('deviceValidityModal').classList.remove('active'); }

function showDeviceLimitModal(userId, currentLimit) {
    document.getElementById('limitUserId').value = userId;
    document.getElementById('editDeviceLimit').value = currentLimit || 1;
    document.getElementById('deviceLimitModal').classList.add('active');
}
function closeDeviceLimitModal() { document.getElementById('deviceLimitModal').classList.remove('active'); }

function showContactModal(userId, phone, email) {
    document.getElementById('contactUserId').value = userId;
    document.getElementById('editPhone').value = phone || '';
    document.getElementById('editEmail').value = email || '';
    document.getElementById('contactModal').classList.add('active');
}
function closeContactModal() { document.getElementById('contactModal').classList.remove('active'); }

function showFeaturesModal(userId, imei = null) {
    document.getElementById('featuresUserId').value = userId;
    document.getElementById('featuresImei').value = imei || '';
    document.getElementById('featuresModal').classList.add('active');
    
    // Fetch current settings for this device or user
    const url = imei ? `/api/admin/device-settings/${imei}` : `/api/admin/customer-settings/${userId}`;
    fetch(url)
        .then(res => res.json())
        .then(settings => {
            const keys = ['odometer', 'speedAlert', 'ignitionAlert', 'healthStats', 'panicAlert', 'harshAlerts', 'towingAlert', 'geofenceAlert', 'csvExport'];
            keys.forEach(key => {
                const el = document.getElementById(`f-${key}`);
                if (el) el.checked = settings[key] !== false;
            });
        });
}

function closeFeaturesModal() {
    document.getElementById('featuresModal').classList.remove('active');
}

async function openCustomerDetail(userId, username, pushToHistory = true) {
    if (pushToHistory) {
        history.pushState({ modal: 'customer', userId, username }, '', `#customer-${userId}`);
    }
    currentViewUserId = userId;
    document.getElementById('customersPanel').style.display = 'none';
    document.getElementById('customerDetailView').style.display = 'block';
    document.getElementById('detailCustomerName').innerText = `${username}'s Fleet`;
    
    // Fetch settings first to know what to hide
    const res = await fetch(`/api/admin/customer-settings/${userId}`);
    currentViewSettings = await res.json();
    
    renderCustomerFleet(userId);
}

function closeCustomerDetail(pushToHistory = true) {
    if (pushToHistory && history.state && history.state.modal === 'customer') {
        history.back();
        return;
    }
    currentViewUserId = null;
    currentViewSettings = null;
    document.getElementById('customersPanel').style.display = '';
    document.getElementById('customerDetailView').style.display = 'none';
    const logBox = document.getElementById('customerLiveLogs');
    if (logBox) logBox.innerHTML = '<div style="color: var(--muted); text-align: center; margin-top: 50px;">Waiting for tracker packet streams...</div>';
}

function renderCustomerFleet(userId) {
    const customer = dashboardCache.customers.find(c => c.id === userId);
    const devices = dashboardCache.allDevices.filter(d => d.ownerId === userId);
    const lastSeen = dashboardCache.lastSeen || {};
    const settings = currentViewSettings || {};
    
    const body = document.getElementById('deviceDetailTableBody');
    body.innerHTML = '';
    
    let active = 0, idle = 0, halt = 0, offline = 0;
    const now = Date.now();

    devices.forEach(d => {
        const ls = lastSeen[d.imei] || {};
        const isOnline = ls.timestamp && (now - new Date(ls.timestamp)) < 120000;
        const speed = ls.speed || 0;
        
        let status = 'Offline';
        let statusColor = '#94a3b8';
        if (isOnline) {
            const s = ls.status || 'halt';
            if (s === 'running') {
                status = 'Active';
                statusColor = 'var(--accent)';
                active++;
            } else if (s === 'idle') {
                status = 'Idle';
                statusColor = 'var(--amber)';
                idle++;
            } else {
                status = 'Halt';
                statusColor = 'var(--red)';
                halt++;
            }
        } else {
            offline++;
        }

        body.innerHTML += `
            <tr id="row-${d.imei}">
                <td>
                    <div style="font-weight:700; color:var(--text);">${d.name || 'Unnamed Device'}</div>
                    <div style="font-size:10px; color:var(--muted); font-family:monospace;">IMEI: ${d.imei}</div>
                </td>
                <td>
                    <span id="status-badge-${d.imei}" class="badge" style="background:rgba(255,255,255,0.03); color:${statusColor}; border-color:${statusColor}44">
                        ${status}
                    </span>
                </td>
                <td id="ts-${d.imei}" style="font-size:11px; color:var(--muted);">
                    ${ls.timestamp ? new Date(ls.timestamp).toLocaleString() : 'Never'}
                </td>
                <td>
                    <div class="detail-card">
                        <div class="detail-row"><span>Speed</span> <span id="speed-${d.imei}">${speed} km/h</span></div>
                        <div class="detail-row">
                            <span>Odo</span> <span id="odo-${d.imei}">${ls.odometer ? ls.odometer.toFixed(2) : '0.00'} km</span>
                        </div>
                        <div class="detail-row">
                            <span>Validity</span> <span style="color: ${d.expirationDate && new Date(d.expirationDate) > new Date() ? 'var(--success, #00e676)' : 'var(--red)'}; font-weight:bold;">${d.expirationDate ? Math.ceil((new Date(d.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) + ' days' : 'N/A'}</span>
                        </div>
                        <div class="detail-row">
                            <span>Voltage</span> <span id="bat-${d.imei}" style="${ls.powerSource === 'secondary' ? 'color: var(--red); font-weight: bold;' : ''}">${ls.voltage !== undefined ? ls.voltage.toFixed(1) : '12.0'} V${ls.powerSource === 'secondary' ? ' (Backup ⚠️)' : ''}</span>
                        </div>
                        <div class="detail-row">
                            <span>Lat/Lng</span> <span id="coords-${d.imei}">${ls.latitude ? ls.latitude.toFixed(4) : '0'}, ${ls.longitude ? ls.longitude.toFixed(4) : '0'}</span>
                        </div>
                    </div>
                </td>
                <td style="text-align:right;">
                    <div class="actions-cell">
                        <button class="icon-btn" onclick="downloadDeviceData('${d.imei}')" title="Download History (CSV)">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="icon-btn" onclick="showDeviceValidityModal('${d.imei}')" title="Recharge Device" style="color:var(--green); border-color:var(--green-dim);">
                            <i class="fa-solid fa-bolt"></i>
                        </button>
                        <button class="icon-btn" onclick="deleteDeviceAdmin('${d.imei}')" title="Delete Device" style="color:var(--red); border-color:var(--red-dim);">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    document.getElementById('countActive').innerText = active;
    document.getElementById('countIdle').innerText = idle;
    document.getElementById('countHalt').innerText = halt;
    if(document.getElementById('countOffline')) document.getElementById('countOffline').innerText = offline;
}

async function submitFeatures() {
    const userId = document.getElementById('featuresUserId').value;
    const imei = document.getElementById('featuresImei').value;
    
    const settings = {
        odometer: document.getElementById('f-odometer').checked,
        speedAlert: document.getElementById('f-speedAlert').checked,
        ignitionAlert: document.getElementById('f-ignitionAlert').checked,
        healthStats: document.getElementById('f-healthStats').checked,
        panicAlert: document.getElementById('f-panicAlert').checked,
        harshAlerts: document.getElementById('f-harshAlerts').checked,
        towingAlert: document.getElementById('f-towingAlert').checked,
        geofenceAlert: document.getElementById('f-geofenceAlert').checked,
        csvExport: document.getElementById('f-csvExport').checked
    };

    const url = imei ? '/api/admin/update-device-settings' : '/api/admin/update-customer-settings';
    const body = imei ? { imei, settings } : { userId, settings };

    const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const result = await res.json();
    if (result.success) {
        closeFeaturesModal();
        // Update local settings cache and redraw customer fleet table if viewing this user
        if (currentViewUserId === userId) {
            currentViewSettings = settings;
            renderCustomerFleet(userId);
        }
        loadDashboard();
    }
}

// -----------------------------------------------------------------------
// Optimized Global Search
// -----------------------------------------------------------------------
function handleGlobalSearch(event) {
    const query = event.target.value.trim().toLowerCase();
    const resultsContainer = document.getElementById('searchResults');
    
    if (!query || !dashboardCache) {
        resultsContainer.classList.remove('active');
        return;
    }

    const matches = [];
    
    // Search Customers
    dashboardCache.customers.forEach(c => {
        if (c.username.toLowerCase().includes(query) || (c.phone && c.phone.includes(query))) {
            matches.push({ type: 'Customer', title: c.username, subtitle: c.phone || 'No Phone', id: c.id, icon: 'user' });
        }
    });

    // Search Devices
    dashboardCache.allDevices.forEach(d => {
        if (d.imei.includes(query) || (d.name && d.name.toLowerCase().includes(query))) {
            const owner = dashboardCache.customers.find(c => c.id === d.ownerId);
            matches.push({ type: 'Device', title: d.name || d.imei, subtitle: `IMEI: ${d.imei} • ${owner ? owner.username : 'Unknown'}`, id: d.imei, icon: 'microchip' });
        }
    });

    if (matches.length > 0) {
        resultsContainer.innerHTML = matches.map(m => `
            <div class="search-result-item" onclick="handleResultClick('${m.type}', '${m.id}', '${m.title.replace(/'/g, "\\'")}')">
                <div class="result-icon"><i class="fa-solid fa-${m.icon}"></i></div>
                <div class="result-info">
                    <div class="result-title">${m.title} <span class="result-tag">${m.type}</span></div>
                    <div class="result-subtitle">${m.subtitle}</div>
                </div>
            </div>
        `).join('');
        resultsContainer.classList.add('active');
    } else {
        resultsContainer.classList.remove('active');
    }
}

function handleResultClick(type, id, title) {
    document.getElementById('searchResults').classList.remove('active');
    document.getElementById('globalSearch').value = '';
    
    if (type === 'Customer') {
        switchPage('customers');
        openCustomerDetail(id, title);
    } else {
        const dev = dashboardCache.allDevices.find(d => d.imei === id);
        if (dev) {
            const cust = dashboardCache.customers.find(c => c.id === dev.ownerId);
            if (cust) {
                switchPage('customers');
                openCustomerDetail(cust.id, cust.username);
                setTimeout(() => {
                    const row = document.getElementById(`row-${id}`);
                    if (row) {
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        row.style.background = 'var(--accent-dim)';
                        setTimeout(() => row.style.background = '', 2500);
                    }
                }, 150);
            }
        } else {
            alert(`Jump to ${type}: ${id}`);
        }
    }
}

// -----------------------------------------------------------------------
// Data Rendering (Sync with new Syne CSS)
// -----------------------------------------------------------------------
async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        if (res.status === 401 || res.status === 403) {
            console.warn('[Dashboard] Unauthorized/Forbidden: Redirecting to login...');
            localStorage.removeItem('user');
            window.location.href = 'login.html';
            return;
        }
        const data = await res.json();
        dashboardCache = data;

        // Update Stats
        document.getElementById('statTotalCustomers').innerText = data.customers.length;
        document.getElementById('statTotalDevices').innerText = data.allDevices.length;
        document.getElementById('statTotalIncome').innerText = `₹${data.totalIncome || 0}`;
        
        let activeCount = 0;
        let idleCount = 0;
        let haltCount = 0;
        let offlineCount = 0;
        const now = Date.now();
        const lastSeen = data.lastSeen || {};
        
        data.allDevices.forEach(d => {
            const ls = lastSeen[d.imei] || {};
            const isOnline = ls.timestamp && (now - new Date(ls.timestamp)) < 120000;
            if (isOnline) {
                const s = ls.status || 'halt';
                if (s === 'running') {
                    activeCount++;
                } else if (s === 'idle') {
                    idleCount++;
                } else {
                    haltCount++;
                }
            } else {
                offlineCount++;
            }
        });
        
        const activeEl = document.getElementById('statOnlineActive');
        if (activeEl) activeEl.innerText = activeCount;
        
        const idleEl = document.getElementById('statOnlineIdle');
        if (idleEl) idleEl.innerText = idleCount;
        
        const haltEl = document.getElementById('statHaltDevices');
        if (haltEl) haltEl.innerText = haltCount;

        const offlineEl = document.getElementById('statOfflineDevices');
        if (offlineEl) offlineEl.innerText = offlineCount;
        
        // Update Doughnut Status Chart
        if (statusChartInstance) {
            statusChartInstance.data.datasets[0].data = [activeCount, idleCount, haltCount, offlineCount];
            statusChartInstance.update();
        }

        // Sync Telemetry History from Server
        if (data.telemetryHistory && telemetryChartInstance) {
            telemetryHistory = data.telemetryHistory;
            telemetryChartInstance.data.datasets[0].data = telemetryHistory;
            telemetryChartInstance.update();
        }
        
        const pendingReqsCount = data.requests.filter(r => r.status === 'pending').length;
        const pendingReqsEl = document.getElementById('statPendingRequests');
        if (pendingReqsEl) pendingReqsEl.innerText = pendingReqsCount;
        
        let expiredCount = 0;
        const dateNow = new Date();

        // Render Billing Table
        const customerBody = document.getElementById('customerTableBody');
        customerBody.innerHTML = data.customers.map(c => {
            const expDate = c.subscription ? new Date(c.subscription.expirationDate) : null;
            const daysLeft = expDate ? Math.ceil((expDate - dateNow) / (1000 * 60 * 60 * 24)) : 0;
            const isExpired = daysLeft <= 0;
            if (isExpired) expiredCount++;

            // Devices belonging to this customer
            const numDevices = (data.allDevices || []).filter(d => d.ownerId === c.id).length;
            const planName = (c.subscription && c.subscription.planName) || 'Trial';
            const deviceLimit = (c.subscription && c.subscription.deviceLimit) || 1;

            return `
                <tr>
                    <td style="cursor:pointer;" onclick="openCustomerDetail('${c.id}', '${c.username}')">
                        <div class="cust-name" style="color:var(--accent);font-weight:700;">${c.username} <i class="fa-solid fa-arrow-right" style="font-size:10px;margin-left:5px;"></i></div>
                        <div style="font-size:10px;color:var(--muted);margin-top:2px;">
                            <i class="fa-solid fa-satellite-dish" style="margin-right:4px;"></i>${numDevices} / ${deviceLimit} device${numDevices !== 1 ? 's' : ''} [${planName}]
                        </div>
                    </td>
                    <td style="cursor:pointer;" onclick="openCustomerDetail('${c.id}', '${c.username}')">
                        <div class="contact-cell">
                            <div class="contact-row"><i class="fa-solid fa-phone" style="width:12px;"></i> ${c.phone || '<span style="color:var(--muted)">N/A</span>'}</div>
                            <div class="contact-row"><i class="fa-solid fa-envelope" style="width:12px;"></i> ${c.email || '<span style="color:var(--muted)">N/A</span>'}</div>
                        </div>
                    </td>
                    <td>
                        <button onclick="showCredentialsModal('${c.id}')" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:5px 12px;color:var(--accent);cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;transition:all .2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                            <i class="fa-solid fa-key"></i> View
                        </button>
                    </td>
                    <td style="text-align:center;">
                        <span class="badge ${isExpired ? 'red' : (daysLeft < 10 ? 'amber' : 'green')}">
                            ${isExpired ? 'Expired' : daysLeft + ' days'}
                        </span>
                    </td>
                    <td>
                        <div class="actions-cell">
                            <div class="icon-btn" title="Set Limit" onclick="showDeviceLimitModal('${c.id}', ${deviceLimit})" style="color:var(--green)"><i class="fa-solid fa-layer-group"></i></div>
                            <div class="icon-btn" title="Features" onclick="showFeaturesModal('${c.id}')" style="color:var(--accent)"><i class="fa-solid fa-sliders"></i></div>
                            <div class="icon-btn" title="Edit Contact" onclick="showContactModal('${c.id}', '${c.phone||''}', '${c.email||''}')"><i class="fa-solid fa-pen"></i></div>
                            <div class="icon-btn" title="Delete" onclick="deleteCustomer('${c.id}')" style="color:var(--red)"><i class="fa-solid fa-trash"></i></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Render Active Requests Table
        const activeRequests = data.requests.filter(r => r.status === 'pending');
        const requestBody = document.getElementById('requestTableBody');
        if (activeRequests.length > 0) {
            requestBody.innerHTML = activeRequests.map(r => {
                const ls = data.lastSeen && data.lastSeen[r.imei];
                const cust = data.customers.find(c => c.id === r.userId);
                const requestedBy = cust ? cust.username : '<span style="color:var(--muted)">Unknown</span>';
                
                const isOnline = ls && ls.timestamp && (Date.now() - new Date(ls.timestamp)) < 120000;
                const dataStatus = ls && ls.timestamp ? 
                    (isOnline ? `<span class="badge green" style="font-size:10px;"><i class="fa-solid fa-signal"></i> Receiving</span>` : `<span class="badge red" style="font-size:10px;"><i class="fa-solid fa-signal"></i> Offline</span>`) : 
                    `<span class="badge red" style="font-size:10px; background: rgba(0,0,0,0.03); color: var(--muted); border-color: var(--border);"><i class="fa-solid fa-signal"></i> No Data</span>`;
                
                return `
                    <tr>
                        <td><code style="color:var(--accent); font-weight:700">${r.imei}</code></td>
                        <td><span class="badge amber">Pending</span></td>
                        <td><span style="font-weight:600; color:var(--text);">${requestedBy}</span></td>
                        <td>
                            ${dataStatus}
                            ${ls && ls.timestamp ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;">Last: ${new Date(ls.timestamp).toLocaleTimeString()}</div>` : ''}
                        </td>
                        <td style="text-align:right; display:flex; align-items:center; justify-content:flex-end; gap:8px;">
                            <select id="ownerSelect-${r.imei}" style="background:var(--surface-2); color:var(--text); border:1px solid var(--border); padding:5px; border-radius:5px; margin-right:4px; font-size:11px; font-family:var(--font-body);">
                                <option value="${cust ? cust.id : ''}">Assign to...</option>
                                ${data.customers.map(customer => `<option value="${customer.id}" ${cust && cust.id === customer.id ? 'selected' : ''}>${customer.username}</option>`).join('')}
                            </select>
                            <button class="icon-btn" style="border-color: rgba(0, 230, 118, 0.3); color: var(--success); background: rgba(0, 230, 118, 0.05);" onclick="approveRequest('${r.imei}')" title="Approve"><i class="fa-solid fa-check"></i></button>
                            <button class="icon-btn" style="border-color: rgba(255, 61, 0, 0.3); color: var(--red); background: rgba(255, 61, 0, 0.05);" onclick="declineRequest('${r.imei}')" title="Decline"><i class="fa-solid fa-xmark"></i></button>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            requestBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted)">No pending requests.</td></tr>`;
        }

        // Render History Requests Table
        const historyRequests = data.requests.filter(r => r.status !== 'pending');
        const historyBody = document.getElementById('requestHistoryTableBody');
        if (historyBody) {
            if (historyRequests.length > 0) {
                historyBody.innerHTML = historyRequests.map(r => {
                    const cust = data.customers.find(c => c.id === r.userId);
                    const statusClass = r.status === 'approved' ? 'green' : 'red';
                    const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A';
                    
                    const ls = data.lastSeen && data.lastSeen[r.imei];
                    const isOnline = ls && ls.timestamp && (Date.now() - new Date(ls.timestamp)) < 120000;
                    const dataStatus = ls && ls.timestamp ? 
                        (isOnline ? `<span class="badge green" style="font-size:10px;"><i class="fa-solid fa-signal"></i> Receiving</span>` : `<span class="badge red" style="font-size:10px;"><i class="fa-solid fa-signal"></i> Offline</span>`) : 
                        `<span class="badge red" style="font-size:10px; background: rgba(0,0,0,0.03); color: var(--muted); border-color: var(--border);"><i class="fa-solid fa-signal"></i> No Data</span>`;

                    return `
                        <tr>
                            <td><code style="color:var(--accent); font-weight:700">${r.imei}</code></td>
                            <td><span class="badge ${statusClass}">${r.status}</span></td>
                            <td style="font-weight: 600;">${cust ? cust.username : 'Unknown User'}</td>
                            <td>
                                ${dataStatus}
                                ${ls && ls.timestamp ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;">Last: ${new Date(ls.timestamp).toLocaleTimeString()}</div>` : ''}
                            </td>
                            <td style="text-align:right; font-size:11px; color:var(--muted);">${timeStr}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                historyBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted)">No requests history logged yet.</td></tr>`;
            }
        }

        // Render Recent Payments Log
        const paymentBody = document.getElementById('paymentTableBody');
        if (paymentBody) {
            if (data.payments && data.payments.length > 0) {
                paymentBody.innerHTML = data.payments.map(p => `
                    <tr>
                        <td><code style="font-family: monospace; font-size: 11px;">TXN_${p.id.substring(p.id.length - 6)}</code></td>
                        <td style="font-weight: 600;">${p.username}</td>
                        <td><span class="badge green" style="font-size: 11px; padding: 3px 8px;">${p.planName}</span></td>
                        <td style="font-weight: 700; color: var(--accent);">₹${p.amount}</td>
                        <td style="font-size: 11px; color: var(--muted);">${new Date(p.timestamp).toLocaleString('en-IN')}</td>
                    </tr>
                `).join('');
            } else {
                paymentBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted)">No payments logged yet.</td></tr>`;
            }
        }

        const expiredEl = document.getElementById('statExpired');
        if (expiredEl) expiredEl.innerText = expiredCount;

        if (currentViewUserId) {
            renderCustomerFleet(currentViewUserId);
        }
        
        renderAllDevices(currentGlobalDeviceFilter);

    } catch (err) { console.error('Dashboard Sync Error:', err); }
}

async function approveRequest(imei) {
    const ownerId = document.getElementById(`ownerSelect-${imei}`).value;
    if (!ownerId) return alert('Select a customer for this device.');

    if (dashboardCache && dashboardCache.allDevices) {
        const existingDevice = dashboardCache.allDevices.find(d => d.imei === imei);
        if (existingDevice) {
            return alert(`Cannot approve! IMEI ${imei} is already registered.`);
        }
    }

    const res = await fetch('/api/admin/approve-request', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ imei, ownerId })
    });
    const result = await res.json();
    if (result.success) {
        alert('Device approved and linked successfully!');
        loadDashboard();
    }
}

async function declineRequest(imei) {
    if (!confirm(`Decline and reject link request for IMEI ${imei}?`)) return;
    const res = await fetch('/api/admin/reject-request', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ imei })
    });
    const result = await res.json();
    if (result.success) loadDashboard();
}

async function deleteCustomer(userId) {
    if (!confirm('Permanently delete this customer?')) return;
    const res = await fetch(`/api/admin/delete-customer/${userId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) loadDashboard();
}

async function deleteDeviceAdmin(imei) {
    if (!confirm(`Permanently delete device IMEI: ${imei}?`)) return;
    const res = await fetch(`/api/admin/delete-device/${imei}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
        alert('Device deleted successfully.');
        loadDashboard(); // Refresh data
    } else {
        alert('Failed to delete device.');
    }
}

async function submitDeviceValidity() {
    const imei = document.getElementById('valImei').value;
    const extraDays = document.getElementById('valDeviceExtraDays').value;
    const res = await fetch('/api/admin/update-device-validity', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ imei, extraDays })
    });
    const result = await res.json();
    if (result.success) { closeDeviceValidityModal(); loadDashboard(); }
    else { alert(result.error || 'Failed to update device validity.'); }
}
async function submitDeviceLimit() {
    const userId = document.getElementById('limitUserId').value;
    const deviceLimit = document.getElementById('editDeviceLimit').value;
    const res = await fetch('/api/admin/update-plan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, deviceLimit, extraDays: 0 })
    });
    const result = await res.json();
    if (result.success) { closeDeviceLimitModal(); loadDashboard(); }
    else { alert(result.error || 'Failed to update device limit.'); }
}

function showPricingModal() {
    const container = document.getElementById('pricingConfigContainer');
    if (!container || !dashboardCache || !dashboardCache.pricing) return;

    const pricing = dashboardCache.pricing;
    container.innerHTML = Object.keys(pricing).map(key => {
        const plan = pricing[key];
        return `
            <div class="pricing-plan-edit-card" style="padding: 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px;">
                <h4 style="color: var(--accent); font-family: var(--font-display); margin-bottom: 10px;">${plan.name} Plan</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                    <div>
                        <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Price (₹)</label>
                        <input type="number" id="p-price-${plan.name}" class="form-control" style="padding: 6px; font-size: 12px;" value="${plan.price}">
                    </div>
                    <div>
                        <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Devices Limit</label>
                        <input type="number" id="p-limit-${plan.name}" class="form-control" style="padding: 6px; font-size: 12px;" value="${plan.deviceLimit}">
                    </div>
                    <div>
                        <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Validity (Days)</label>
                        <input type="number" id="p-days-${plan.name}" class="form-control" style="padding: 6px; font-size: 12px;" value="${plan.validityDays}">
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('pricingModal').classList.add('active');
}

function closePricingModal() {
    document.getElementById('pricingModal').classList.remove('active');
}

async function submitPricingSettings() {
    if (!dashboardCache || !dashboardCache.pricing) return;
    
    const updatedPlans = {};
    Object.keys(dashboardCache.pricing).forEach(key => {
        updatedPlans[key] = {
            name: key,
            price: parseFloat(document.getElementById(`p-price-${key}`).value || 0),
            deviceLimit: parseInt(document.getElementById(`p-limit-${key}`).value || 1),
            validityDays: parseInt(document.getElementById(`p-days-${key}`).value || 30)
        };
    });

    try {
        const res = await fetch('/api/admin/pricing', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ plans: updatedPlans })
        });
        const data = await res.json();
        if (data.success) {
            closePricingModal();
            loadDashboard();
            alert('Plan configurations updated successfully!');
        } else {
            alert('Failed to save configurations.');
        }
    } catch (e) {
        alert('Server connection error.');
    }
}

async function submitContact() {
    const userId = document.getElementById('contactUserId').value;
    const phone = document.getElementById('editPhone').value;
    const email = document.getElementById('editEmail').value;
    const res = await fetch('/api/admin/update-contact', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, phone, email })
    });
    const result = await res.json();
    if (result.success) { closeContactModal(); loadDashboard(); }
}

async function submitCustomer() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const phone = document.getElementById('newPhone').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    if (!username || !password) return alert('Missing info');
    
    const res = await fetch('/api/admin/create-customer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password, phone, email })
    });
    if (res.status === 401 || res.status === 403) {
        alert('Session expired or access denied. Please log in again.');
        window.location.href = 'login.html';
        return;
    }
    const result = await res.json();
    if (result.success) {
        closeAddCustomerModal();
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newPhone').value = '';
        document.getElementById('newEmail').value = '';
        loadDashboard();
    } else {
        alert(result.error || 'Failed to create customer');
    }
}

function downloadDeviceData(imei) {
    window.location.href = `/api/export/history/${imei}`;
}

function exportCurrentCustomerFleet() {
    if (!currentViewUserId) return;
    window.location.href = `/api/export/devices?userId=${currentViewUserId}&role=customer`;
}

// -----------------------------------------------------------------------
// Real-time Terminal Logic
// -----------------------------------------------------------------------

const socket = io();
socket.on('admin_update', loadDashboard);

socket.on('device_data', (data) => {
    // Only update if we are viewing this customer's fleet
    if (currentViewUserId && data.ownerId === currentViewUserId) {
        const { imei, speed, odometer, battery, latitude, longitude, timestamp } = data;
        
        const speedEl = document.getElementById(`speed-${imei}`);
        if (speedEl) {
            speedEl.innerText = `${speed} km/h`;
            if (odometer !== undefined && document.getElementById(`odo-${imei}`)) {
                document.getElementById(`odo-${imei}`).innerText = `${odometer.toFixed(2)} km`;
            }
            if (document.getElementById(`bat-${imei}`)) {
                const isSecondary = (data.powerSource === 'secondary');
                const batEl = document.getElementById(`bat-${imei}`);
                const voltVal = data.voltage !== undefined ? data.voltage.toFixed(1) : '12.0';
                batEl.innerText = isSecondary ? `${voltVal} V (Backup ⚠️)` : `${voltVal} V`;
                batEl.style.color = isSecondary ? 'var(--red)' : '';
                batEl.style.fontWeight = isSecondary ? 'bold' : '';
            }
            if (latitude && document.getElementById(`coords-${imei}`)) {
                document.getElementById(`coords-${imei}`).innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            }
            
            document.getElementById(`ts-${imei}`).innerText = new Date(timestamp).toLocaleString();
            
            // Update badge
            const badge = document.getElementById(`status-badge-${imei}`);
            let status = 'Halt';
            let color = 'var(--red)';
            const s = data.status || 'halt';
            if (s === 'running') {
                status = 'Active';
                color = 'var(--accent)';
            } else if (s === 'idle') {
                status = 'Idle';
                color = 'var(--amber)';
            }
            if (badge) {
                badge.innerText = status;
                badge.style.color = color;
                badge.style.borderColor = color + '44';
            }

            // Append to raw telemetry stream box
            const logBox = document.getElementById('customerLiveLogs');
            if (logBox) {
                if (logBox.innerText.includes('Waiting for tracker')) {
                    logBox.innerHTML = '';
                }
                const timeStr = new Date(timestamp).toLocaleTimeString();
                const logEntry = document.createElement('div');
                logEntry.style.borderBottom = '1px solid rgba(0,0,0,0.03)';
                logEntry.style.padding = '4px 0';
                logEntry.innerHTML = `<span style="color:var(--muted)">[${timeStr}]</span> <b style="color:var(--text);">${data.name || imei}:</b> Lat:${latitude.toFixed(6)} Lng:${longitude.toFixed(6)} Speed:${speed}km/h Odo:${odometer.toFixed(2)}km Hex:[<span style="color:var(--accent); font-family:monospace; font-weight:700;">${data.rawHex || 'N/A'}</span>]`;
                logBox.appendChild(logEntry);
                logBox.scrollTop = logBox.scrollHeight;
            }
        }
        
        // Also update the dashboardCache so if they close/open it's fresh
        if (dashboardCache && dashboardCache.lastSeen) {
            dashboardCache.lastSeen[imei] = data;
        }
    }
});

socket.on('admin_live_log', (log) => {
    packetsReceivedThisMinute++;
    if (telemetryChartInstance) {
        telemetryHistory[telemetryHistory.length - 1] = packetsReceivedThisMinute;
        telemetryChartInstance.update();
    }
    const container = document.getElementById('liveLogs');
    if(container) {
        const line = document.createElement('div');
        line.className = 'log-entry';
        line.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> <span style="color:var(--accent); font-weight:700">IMEI:${log.imei}</span> <span style="color:var(--muted)">> ${log.hex}</span>`;
        container.prepend(line);
        if(container.children.length > 50) container.lastElementChild.remove();
    }

    if (currentViewUserId && dashboardCache) {
        const isCustomerDevice = dashboardCache.allDevices.some(d => d.imei === log.imei && d.ownerId === currentViewUserId);
        if (isCustomerDevice) {
            const logBox = document.getElementById('customerLiveLogs');
            if (logBox) {
                if (logBox.innerText.includes('Waiting for tracker')) {
                    logBox.innerHTML = '';
                }
                const timeStr = new Date().toLocaleTimeString();
                const logEntry = document.createElement('div');
                logEntry.style.borderBottom = '1px solid rgba(0,0,0,0.03)';
                logEntry.style.padding = '4px 0';
                logEntry.innerHTML = `<span style="color:var(--muted)">[${timeStr}]</span> <b style="color:var(--text);">${log.imei}:</b> Raw HEX Received - Hex:[<span style="color:var(--accent); font-family:monospace; font-weight:700;">${log.hex || 'N/A'}</span>]`;
                logBox.appendChild(logEntry);
                logBox.scrollTop = logBox.scrollHeight;
            }
        }
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) {
        document.getElementById('searchResults')?.classList.remove('active');
    }
});

// Periodically refresh the dashboard and active customer fleet view to sync elapsed time and offline status
setInterval(() => {
    if (user && user.role === 'admin') {
        loadDashboard();
    }
}, 10000);
