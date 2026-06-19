// ============================================================
// KYC Validator Engine — Aleanvition Platform
// Indian document format validation (rule-based, no external API)
// ============================================================

const KYC_VALIDATORS = {
    aadhaar: {
        label: 'Aadhaar Card',
        pattern: /^\d{12}$/,
        hint: '12-digit number (e.g. 1234 5678 9012)'
    },
    pan: {
        label: 'PAN Card',
        pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
        hint: '10-character format: ABCDE1234F'
    },
    voter_id: {
        label: 'Voter ID',
        pattern: /^[A-Z]{3}[0-9]{7}$/,
        hint: '10-character format: ABC1234567'
    },
    passport: {
        label: 'Passport',
        pattern: /^[A-Z]{1}[0-9]{7}$/,
        hint: '8-character format: A1234567'
    },
    driving_license: {
        label: 'Driving License',
        pattern: /^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/,
        hint: '15-character format: MH0120210012345'
    }
};

const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const CIN_PATTERN = /^[LUu]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

let currentKycUserId = null;
let currentApplicantType = 'individual';
let kycData = [];

// ============================================================
// Tab Switching
// ============================================================
function switchTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.admin-tab-btn[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'kyc') loadKycPanel();
}

// ============================================================
// KYC Panel Rendering
// ============================================================
async function loadKycPanel() {
    try {
        const res = await fetch('/api/admin/kyc/list');
        kycData = await res.json();
        renderKycTable(kycData);
    } catch(e) {
        console.error('Failed to load KYC data', e);
    }
}

function renderKycTable(apps) {
    const tbody = document.getElementById('kycTableBody');
    if (!apps || apps.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="6">
                <div class="empty-state">
                    <i class="fa-solid fa-id-card"></i>
                    <p>No KYC applications submitted yet.</p>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = apps.map(k => {
        const statusBadge = getKycStatusBadge(k.status);
        const typeIcon = k.applicantType === 'individual' 
            ? '<i class="fa-solid fa-user"></i> Individual'
            : '<i class="fa-solid fa-building"></i> Organization';
        const name = k.applicantType === 'individual' ? k.fullName : k.orgName;
        const doc = k.applicantType === 'individual'
            ? `${KYC_VALIDATORS[k.docType]?.label || k.docType}: <code>${k.docNumber}</code>`
            : `GST: <code>${k.gstNumber || '—'}</code>`;
        const submittedAt = k.submittedAt ? new Date(k.submittedAt).toLocaleDateString('en-IN') : '—';
        
        const actionBtns = k.status === 'under_review' ? `
            <div class="action-btns">
                <button class="btn-icon approve" title="Approve KYC" onclick="approveKyc('${k.id}')">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn-icon reject" title="Reject KYC" onclick="openRejectModal('${k.id}')">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>` : `<span style="font-size:0.8rem; color: var(--text-secondary);">—</span>`;

        return `
        <tr>
            <td>
                <div style="font-weight: 700;">${k.username}</div>
                <div style="font-size: 0.72rem; color: var(--text-secondary); font-family: monospace;">ID: ${k.userId?.substring(0,8)}...</div>
            </td>
            <td><span class="kyc-type-tag">${typeIcon}</span></td>
            <td style="font-weight: 600;">${name || '—'}</td>
            <td style="font-size: 0.82rem;">${doc}</td>
            <td>${statusBadge}</td>
            <td>${actionBtns}</td>
        </tr>`;
    }).join('');
}

function getKycStatusBadge(status) {
    switch(status) {
        case 'verified':    return '<span class="badge badge-kyc-verified"><i class="fa-solid fa-shield-check"></i> Verified</span>';
        case 'under_review':return '<span class="badge badge-kyc-pending"><i class="fa-solid fa-hourglass-half fa-spin"></i> Under Review</span>';
        case 'rejected':    return '<span class="badge badge-kyc-rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>';
        default:            return '<span class="badge badge-info">Unknown</span>';
    }
}

// ============================================================
// KYC Modal
// ============================================================
function openKycModal(userId) {
    currentKycUserId = userId;
    currentApplicantType = 'individual';
    // Reset form
    document.getElementById('kycIndividualForm').style.display = 'block';
    document.getElementById('kycOrgForm').style.display = 'none';
    document.getElementById('kycDocNumber').value = '';
    document.getElementById('kycFullName').value = '';
    document.getElementById('kycDob').value = '';
    document.getElementById('kycDocType').value = 'aadhaar';
    document.getElementById('kycOrgName').value = '';
    document.getElementById('kycGstNumber').value = '';
    document.getElementById('kycAuthSignatory').value = '';
    document.getElementById('kycAuthLetter').value = '';
    clearAllValidations();
    setApplicantType('individual');
    document.getElementById('kycModal').classList.add('active');
}

function closeKycModal() {
    document.getElementById('kycModal').classList.remove('active');
    currentKycUserId = null;
}

function setApplicantType(type) {
    currentApplicantType = type;
    document.querySelectorAll('.kyc-type-card').forEach(c => c.classList.remove('active'));
    document.querySelector(`.kyc-type-card[data-type="${type}"]`).classList.add('active');
    if (type === 'individual') {
        document.getElementById('kycIndividualForm').style.display = 'block';
        document.getElementById('kycOrgForm').style.display = 'none';
    } else {
        document.getElementById('kycIndividualForm').style.display = 'none';
        document.getElementById('kycOrgForm').style.display = 'block';
    }
    clearAllValidations();
}

function clearAllValidations() {
    document.querySelectorAll('.kyc-field-wrap').forEach(w => {
        w.classList.remove('valid', 'invalid');
        const icon = w.querySelector('.val-icon');
        if (icon) icon.innerHTML = '';
        const hint = w.querySelector('.field-hint');
        if (hint) hint.style.display = 'none';
    });
}

// ============================================================
// Live Validation
// ============================================================
function validateField(inputEl, isValid, hintText = '') {
    const wrap = inputEl.closest('.kyc-field-wrap');
    if (!wrap) return;
    const icon = wrap.querySelector('.val-icon');
    const hint = wrap.querySelector('.field-hint');
    
    wrap.classList.toggle('valid', isValid);
    wrap.classList.toggle('invalid', !isValid);
    if (icon) icon.innerHTML = isValid 
        ? '<i class="fa-solid fa-circle-check"></i>'
        : '<i class="fa-solid fa-circle-xmark"></i>';
    if (hint && !isValid && hintText) {
        hint.textContent = hintText;
        hint.style.display = 'block';
    } else if (hint) {
        hint.style.display = 'none';
    }
}

function onDocNumberInput(el) {
    const val = el.value.trim().toUpperCase();
    el.value = val;
    const docType = document.getElementById('kycDocType').value;
    const validator = KYC_VALIDATORS[docType];
    if (!validator || val.length === 0) { clearFieldValidation(el); return; }
    validateField(el, validator.pattern.test(val), validator.hint);
}

function onDocTypeChange() {
    const docType = document.getElementById('kycDocType').value;
    const validator = KYC_VALIDATORS[docType];
    const docInput = document.getElementById('kycDocNumber');
    if (validator) {
        docInput.placeholder = validator.hint;
    }
    if (docInput.value) onDocNumberInput(docInput);
}

function onGstInput(el) {
    const val = el.value.trim().toUpperCase();
    el.value = val;
    if (!val) { clearFieldValidation(el); return; }
    validateField(el, GST_PATTERN.test(val), 'Format: 27AAAAA0000A1Z5 (15 characters)');
}

function onNameInput(el) {
    const val = el.value.trim();
    if (!val) { clearFieldValidation(el); return; }
    validateField(el, val.length >= 3, 'Please enter full legal name (at least 3 characters)');
}

function clearFieldValidation(el) {
    const wrap = el.closest('.kyc-field-wrap');
    if (!wrap) return;
    wrap.classList.remove('valid', 'invalid');
    const icon = wrap.querySelector('.val-icon');
    if (icon) icon.innerHTML = '';
    const hint = wrap.querySelector('.field-hint');
    if (hint) hint.style.display = 'none';
}

// ============================================================
// Submit KYC
// ============================================================
async function submitKyc() {
    if (!currentKycUserId) return;
    
    let payload = { userId: currentKycUserId, applicantType: currentApplicantType };
    
    if (currentApplicantType === 'individual') {
        const fullName = document.getElementById('kycFullName').value.trim();
        const dob = document.getElementById('kycDob').value;
        const docType = document.getElementById('kycDocType').value;
        const docNumber = document.getElementById('kycDocNumber').value.trim().toUpperCase();
        const validator = KYC_VALIDATORS[docType];
        
        if (!fullName || fullName.length < 3) { showKycError('Please enter the full legal name.'); return; }
        if (!dob) { showKycError('Please enter date of birth.'); return; }
        if (!docNumber || !validator?.pattern.test(docNumber)) {
            showKycError(`Invalid ${validator?.label || 'document'} number. ${validator?.hint || ''}`);
            return;
        }
        payload = { ...payload, fullName, dob, docType, docNumber };
    } else {
        const orgName = document.getElementById('kycOrgName').value.trim();
        const gstNumber = document.getElementById('kycGstNumber').value.trim().toUpperCase();
        const authSignatory = document.getElementById('kycAuthSignatory').value.trim();
        const authLetter = document.getElementById('kycAuthLetter').value.trim();
        
        if (!orgName || orgName.length < 3) { showKycError('Please enter the organization name.'); return; }
        if (!gstNumber || !GST_PATTERN.test(gstNumber)) { showKycError('Invalid GST number. Format: 27AAAAA0000A1Z5'); return; }
        if (!authSignatory || authSignatory.length < 3) { showKycError('Please enter the authorized signatory name.'); return; }
        if (!authLetter) { showKycError('Please specify the authorization letter reference.'); return; }
        payload = { ...payload, orgName, gstNumber, authSignatory, authLetter };
    }
    
    try {
        const res = await fetch('/api/admin/kyc/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            closeKycModal();
            switchTab('kyc');
            showKycToast('KYC application submitted successfully.', 'success');
        }
    } catch(e) {
        showKycError('Failed to submit KYC. Please try again.');
    }
}

function showKycError(msg) {
    const errEl = document.getElementById('kycError');
    errEl.textContent = msg;
    errEl.style.display = 'block';
    setTimeout(() => errEl.style.display = 'none', 4000);
}

// ============================================================
// Approve / Reject
// ============================================================
async function approveKyc(kycId) {
    const res = await fetch('/api/admin/kyc/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kycId })
    });
    const data = await res.json();
    if (data.success) {
        showKycToast('KYC approved. Customer is now verified.', 'success');
        loadKycPanel();
    }
}

function openRejectModal(kycId) {
    document.getElementById('rejectKycId').value = kycId;
    document.getElementById('rejectReason').value = '';
    document.getElementById('rejectModal').classList.add('active');
}

function closeRejectModal() {
    document.getElementById('rejectModal').classList.remove('active');
}

async function submitReject() {
    const kycId = document.getElementById('rejectKycId').value;
    const reason = document.getElementById('rejectReason').value.trim() || 'Rejected by admin';
    const res = await fetch('/api/admin/kyc/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kycId, reason })
    });
    const data = await res.json();
    if (data.success) {
        closeRejectModal();
        showKycToast('KYC application rejected.', 'warning');
        loadKycPanel();
    }
}

// ============================================================
// Toast Notification
// ============================================================
function showKycToast(message, type = 'info') {
    const container = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-alert ${type}`;
    const iconMap = { success: 'fa-circle-check', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    toast.innerHTML = `
        <div class="toast-icon"><i class="fa-solid ${iconMap[type] || 'fa-circle-info'}"></i></div>
        <div class="toast-content">
            <div class="toast-title">KYC System</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-hiding'); setTimeout(() => toast.remove(), 400); }, 4000);
}

function createToastContainer() {
    const div = document.createElement('div');
    div.id = 'toastContainer';
    div.className = 'toast-container';
    document.body.appendChild(div);
    return div;
}
