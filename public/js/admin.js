const user = JSON.parse(localStorage.getItem('user'));
if (!user || user.role !== 'admin') {
    window.location.href = 'index.html';
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

function showAddCustomerModal() { document.getElementById('addCustomerModal').classList.add('active'); }
function closeAddCustomerModal() { document.getElementById('addCustomerModal').classList.remove('active'); }
function showValidityModal(userId) { 
    document.getElementById('valUserId').value = userId;
    document.getElementById('validityModal').classList.add('active'); 
}
function closeValidityModal() { document.getElementById('validityModal').classList.remove('active'); }

async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        
        // Update stats
        let expiredCount = 0;
        data.customers.forEach(c => {
            if(c.subscription) {
                const expDate = new Date(c.subscription.expirationDate);
                const daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 0) expiredCount++;
            }
        });
        
        document.getElementById('statTotalCustomers').innerText = data.customers.length;
        document.getElementById('statTotalDevices').innerText = data.allDevices.length;
        document.getElementById('statExpired').innerText = expiredCount;
        
        renderCustomers(data.customers);
        renderRequests(data.requests);
    } catch(e) {
        console.error("Failed to load dashboard", e);
    }
}

function renderCustomers(customers) {
    const tbody = document.getElementById('customerTableBody');
    tbody.innerHTML = customers.map(c => {
        let daysLeft = 0;
        if(c.subscription) {
            const expDate = new Date(c.subscription.expirationDate);
            daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
            if(daysLeft < 0) daysLeft = 0;
        }
        
        const isExpired = daysLeft <= 0;
        const statusClass = isExpired ? 'danger' : 'success';
        const bgRow = isExpired ? 'rgba(239, 68, 68, 0.05)' : 'transparent';
        
        return `
        <tr style="border-bottom: 1px solid var(--border-light); background: ${bgRow}; transition: background 0.2s;">
            <td style="padding: 1rem;">
                <div style="font-weight: 600; font-size: 1.05rem;">${c.username}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">ID: ${c.id.substring(0,8)}...</div>
            </td>
            <td style="padding: 1rem; text-align: center;">
                <span style="display: inline-flex; align-items: center; gap: 6px; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; background: var(--${statusClass}-glow); color: var(--${statusClass}); border: 1px solid rgba(255,255,255,0.1);">
                    ${isExpired ? '<i class="fa-solid fa-lock"></i> Expired' : '<i class="fa-solid fa-check"></i> Active'} (${daysLeft} days)
                </span>
            </td>
            <td style="padding: 1rem; text-align: right;">
                <button class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="showValidityModal('${c.id}')"><i class="fa-solid fa-plus"></i> Recharge</button>
            </td>
        </tr>
    `}).join('');
}

function renderRequests(requests) {
    const tbody = document.getElementById('requestTableBody');
    if(requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color:var(--text-secondary);">No pending device requests.</td></tr>';
        return;
    }
    
    tbody.innerHTML = requests.map(r => {
        const hasData = r.lastSeen != null;
        const packetStr = hasData ? r.lastSeen.rawHex : 'Waiting for device to connect...';
        
        return `
        <tr style="border-bottom: 1px solid var(--border-light);">
            <td style="padding: 1rem; font-family: monospace; color: var(--primary); font-weight: 600;">${r.imei}</td>
            <td style="padding: 1rem;">${r.username}</td>
            <td style="padding: 1rem;">
                ${hasData 
                    ? `<span style="color:var(--success); font-size: 0.85rem; font-weight:600;"><i class="fa-solid fa-signal"></i> Online</span>
                       <div style="font-size: 0.7rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px;">${packetStr}</div>` 
                    : `<span style="color:var(--warning); font-size: 0.85rem; font-weight:600;"><i class="fa-solid fa-clock-rotate-left fa-spin"></i> Pending</span>`}
            </td>
            <td style="padding: 1rem; text-align: right;">
                <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" 
                        onclick="approveDevice('${r.id}')" ${!hasData ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                    Approve
                </button>
            </td>
        </tr>
    `}).join('');
}

async function submitCustomer() {
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    if(!username || !password) return alert('Enter both fields');
    
    const res = await fetch('/api/admin/create-customer', {
        method: 'POST',
        headers:{'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if(data.success) {
        closeAddCustomerModal();
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        loadDashboard();
    } else {
        alert(data.error);
    }
}

async function submitValidity() {
    const userId = document.getElementById('valUserId').value;
    const days = document.getElementById('addDays').value;
    
    const res = await fetch('/api/admin/update-validity', {
        method: 'POST',
        headers:{'Content-Type': 'application/json'},
        body: JSON.stringify({userId, days})
    });
    await res.json();
    closeValidityModal();
    loadDashboard();
}

async function approveDevice(requestId) {
    const res = await fetch('/api/admin/approve-device', {
        method: 'POST',
        headers:{'Content-Type': 'application/json'},
        body: JSON.stringify({requestId})
    });
    await res.json();
    loadDashboard();
}

// Initial load
loadDashboard();
// Refresh every 5 seconds to check for new data on pending devices
setInterval(loadDashboard, 5000);
