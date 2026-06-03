const user = JSON.parse(localStorage.getItem('user'));
if (!user || user.role !== 'admin') {
    window.location.href = 'index.html';
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

let dashboardCache = null;
let currentViewUserId = null;
let currentViewSettings = null;

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
    const text = `Fleetly GPS Login\nUsername: ${username}\nPassword: ${password}\nPortal: ${window.location.origin}`;
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

function showValidityModal(userId) {
    document.getElementById('valUserId').value = userId;
    document.getElementById('validityModal').classList.add('active');
}
function closeValidityModal() { document.getElementById('validityModal').classList.remove('active'); }

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
            const keys = ['odometer', 'speedAlert', 'ignitionAlert', 'healthStats', 'panicAlert', 'harshAlerts', 'towingAlert'];
            keys.forEach(key => {
                const el = document.getElementById(`f-${key}`);
                if (el) el.checked = settings[key] !== false;
            });
        });
}

function closeFeaturesModal() {
    document.getElementById('featuresModal').classList.remove('active');
}

async function openCustomerDetail(userId, username) {
    currentViewUserId = userId;
    document.getElementById('mainListView').style.display = 'none';
    document.getElementById('customerDetailView').style.display = 'block';
    document.getElementById('detailCustomerName').innerText = `${username}'s Fleet`;
    
    // Fetch settings first to know what to hide
    const res = await fetch(`/api/admin/customer-settings/${userId}`);
    currentViewSettings = await res.json();
    
    renderCustomerFleet(userId);
}

function closeCustomerDetail() {
    currentViewUserId = null;
    currentViewSettings = null;
    document.getElementById('mainListView').style.display = 'contents';
    document.getElementById('customerDetailView').style.display = 'none';
}

function renderCustomerFleet(userId) {
    const customer = dashboardCache.customers.find(c => c.id === userId);
    const devices = dashboardCache.allDevices.filter(d => d.ownerId === userId);
    const lastSeen = dashboardCache.lastSeen || {};
    const settings = currentViewSettings || {};
    
    const body = document.getElementById('deviceDetailTableBody');
    body.innerHTML = '';
    
    let active = 0, idle = 0, halt = 0;
    const now = Date.now();

    devices.forEach(d => {
        const ls = lastSeen[d.imei] || {};
        const isOnline = ls.timestamp && (now - new Date(ls.timestamp)) < 60000;
        const speed = ls.speed || 0;
        
        let status = 'Halt';
        let statusColor = 'var(--red)';
        if (isOnline) {
            if (speed > 5) {
                status = 'Active';
                statusColor = 'var(--accent)';
                active++;
            } else {
                status = 'Idle';
                statusColor = 'var(--amber)';
                idle++;
            }
        } else {
            halt++;
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
                            <span>Battery</span> <span id="bat-${d.imei}">${ls.battery || 'N/A'}%</span>
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
                    </div>
                </td>
            </tr>
        `;
    });

    document.getElementById('countActive').innerText = active;
    document.getElementById('countIdle').innerText = idle;
    document.getElementById('countHalt').innerText = halt;
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
        towingAlert: document.getElementById('f-towingAlert').checked
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
            <div class="search-result-item" onclick="handleResultClick('${m.type}', '${m.id}')">
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

function handleResultClick(type, id) {
    document.getElementById('searchResults').classList.remove('active');
    document.getElementById('globalSearch').value = '';
    
    if (type === 'Customer') {
        const row = Array.from(document.querySelectorAll('#customerTableBody tr')).find(r => r.innerText.includes(id));
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.background = 'var(--accent-dim)';
            setTimeout(() => row.style.background = '', 2500);
        }
    } else {
        alert(`Jump to ${type}: ${id}`);
    }
}

// -----------------------------------------------------------------------
// Data Rendering (Sync with new Syne CSS)
// -----------------------------------------------------------------------
async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        dashboardCache = data;

        // Update Stats
        document.getElementById('statTotalCustomers').innerText = data.customers.length;
        document.getElementById('statTotalDevices').innerText = data.allDevices.length;
        
        let expiredCount = 0;
        const now = new Date();

        // Render Billing Table
        const customerBody = document.getElementById('customerTableBody');
        customerBody.innerHTML = data.customers.map(c => {
            const expDate = c.subscription ? new Date(c.subscription.expirationDate) : null;
            const daysLeft = expDate ? Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)) : 0;
            const isExpired = daysLeft <= 0;
            if (isExpired) expiredCount++;

            // Devices belonging to this customer
            const numDevices = (data.allDevices || []).filter(d => d.ownerId === c.id).length;

            return `
                <tr>
                    <td>
                        <div style="cursor:pointer" onclick="openCustomerDetail('${c.id}', '${c.username}')">
                            <div class="cust-name" style="color:var(--accent);font-weight:700;">${c.username} <i class="fa-solid fa-arrow-right" style="font-size:10px;margin-left:5px;"></i></div>
                            <div style="font-size:10px;color:var(--muted);margin-top:2px;"><i class="fa-solid fa-satellite-dish" style="margin-right:4px;"></i>${numDevices} device${numDevices !== 1 ? 's' : ''}</div>
                        </div>
                    </td>
                    <td>
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
                            <div class="icon-btn" title="Features" onclick="showFeaturesModal('${c.id}')" style="color:var(--accent)"><i class="fa-solid fa-sliders"></i></div>
                            <div class="icon-btn" title="Recharge" onclick="showValidityModal('${c.id}')"><i class="fa-solid fa-bolt"></i></div>
                            <div class="icon-btn" title="Edit Contact" onclick="showContactModal('${c.id}', '${c.phone||''}', '${c.email||''}')"><i class="fa-solid fa-pen"></i></div>
                            <div class="icon-btn" title="Delete" onclick="deleteCustomer('${c.id}')" style="color:var(--red)"><i class="fa-solid fa-trash"></i></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Render Requests Table
        const requestBody = document.getElementById('requestTableBody');
        requestBody.innerHTML = data.requests.map(r => `
            <tr>
                <td><code style="color:var(--accent); font-weight:700">${r.imei}</code></td>
                <td><span class="badge amber">Pending</span></td>
                <td style="text-align:right">
                    <select id="ownerSelect-${r.imei}" style="background:var(--surface-2); color:var(--text); border:1px solid var(--border); padding:5px; border-radius:5px; margin-right:8px; font-size:11px;">
                        <option value="">Assign to...</option>
                        ${data.customers.map(cust => `<option value="${cust.id}">${cust.username}</option>`).join('')}
                    </select>
                    <button class="icon-btn" style="display:inline-flex" onclick="approveRequest('${r.imei}')"><i class="fa-solid fa-check"></i></button>
                </td>
            </tr>
        `).join('');

        document.getElementById('statExpired').innerText = expiredCount;

    } catch (err) { console.error('Dashboard Sync Error:', err); }
}

async function approveRequest(imei) {
    const ownerId = document.getElementById(`ownerSelect-${imei}`).value;
    if (!ownerId) return alert('Select a customer for this device.');
    const res = await fetch('/api/admin/approve-request', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ imei, ownerId })
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

async function submitValidity() {
    const userId = document.getElementById('valUserId').value;
    const days = document.getElementById('addDays').value;
    const res = await fetch('/api/admin/update-validity', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, days })
    });
    const result = await res.json();
    if (result.success) { closeValidityModal(); loadDashboard(); }
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
    const result = await res.json();
    if (result.success) { closeAddCustomerModal(); loadDashboard(); }
}

function downloadDeviceData(imei) {
    window.location.href = `/api/export/history/${imei}`;
}

// -----------------------------------------------------------------------
// Real-time Terminal Logic
// -----------------------------------------------------------------------
loadDashboard();
const socket = io();
socket.on('admin_update', loadDashboard);

socket.on('device_data', (data) => {
    // Only update if we are viewing this customer's fleet
    if (currentViewUserId && data.ownerId === currentViewUserId) {
        const { imei, speed, odometer, battery, latitude, longitude, timestamp } = data;
        
        const speedEl = document.getElementById(`speed-${imei}`);
        if (speedEl) {
            speedEl.innerText = `${speed} km/h`;
            if (odometer && document.getElementById(`odo-${imei}`)) {
                document.getElementById(`odo-${imei}`).innerText = `${odometer.toFixed(2)} km`;
            }
            if (battery && document.getElementById(`bat-${imei}`)) {
                document.getElementById(`bat-${imei}`).innerText = `${battery}%`;
            }
            if (latitude && document.getElementById(`coords-${imei}`)) {
                document.getElementById(`coords-${imei}`).innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            }
            
            document.getElementById(`ts-${imei}`).innerText = new Date(timestamp).toLocaleString();
            
            // Update badge
            const badge = document.getElementById(`status-badge-${imei}`);
            let status = 'Idle';
            let color = 'var(--amber)';
            if (speed > 5) {
                status = 'Active';
                color = 'var(--accent)';
            }
            badge.innerText = status;
            badge.style.color = color;
            badge.style.borderColor = color + '44';
        }
        
        // Also update the dashboardCache so if they close/open it's fresh
        if (dashboardCache && dashboardCache.lastSeen) {
            dashboardCache.lastSeen[imei] = data;
        }
    }
});
socket.on('admin_live_log', (log) => {
    const container = document.getElementById('liveLogs');
    if(!container) return;
    const line = document.createElement('div');
    line.className = 'log-entry';
    line.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> <span style="color:var(--accent); font-weight:700">IMEI:${log.imei}</span> <span style="color:#8ba4b8">> ${log.hex}</span>`;
    container.prepend(line);
    if(container.children.length > 50) container.lastElementChild.remove();
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) {
        document.getElementById('searchResults')?.classList.remove('active');
    }
});
