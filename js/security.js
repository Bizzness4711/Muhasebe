function securityStorageKey(suffix) {
    return currentUser ? `security-${suffix}-${currentUser.uid}` : null;
}

async function hashSecurityPin(pin) {
    const data = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hasSecurityPin() {
    return Boolean(securityStorageKey('pin') && localStorage.getItem(securityStorageKey('pin')));
}

function isSecurityAppLocked() {
    return Boolean(securityStorageKey('locked') && localStorage.getItem(securityStorageKey('locked')) === 'true');
}

function getSecurityTimeoutMinutes() {
    const value = Number(localStorage.getItem(securityStorageKey('timeout') || '') || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function scheduleSecurityLock() {
    if (securityTimeoutId) clearTimeout(securityTimeoutId);
    if (!currentUser || securityLocked || !hasSecurityPin()) return;
    const minutes = getSecurityTimeoutMinutes();
    if (minutes > 0) securityTimeoutId = setTimeout(lockSecurityApp, minutes * 60 * 1000);
}

function lockSecurityApp() {
    if (!hasSecurityPin() || securityLocked) return;
    securityLocked = true;
    localStorage.setItem(securityStorageKey('locked'), 'true');
    const lock = document.getElementById('securityLock');
    if (lock) lock.hidden = false;
    const pin = document.getElementById('unlockPin');
    if (pin) { pin.value = ''; pin.focus(); }
    if (securityTimeoutId) clearTimeout(securityTimeoutId);
}

function unlockSecurityApp() {
    securityLocked = false;
    localStorage.removeItem(securityStorageKey('locked'));
    const lock = document.getElementById('securityLock');
    if (lock) lock.hidden = true;
    const error = document.getElementById('unlockError');
    if (error) error.textContent = '';
    scheduleSecurityLock();
}

async function configureSecurityUI() {
    const timeout = document.getElementById('securityTimeout');
    if (timeout) timeout.value = String(getSecurityTimeoutMinutes());
    if (!securityActivityBound) {
        ['click', 'keydown', 'pointermove', 'touchstart'].forEach(eventName => {
            document.addEventListener(eventName, () => {
                if (!securityLocked) scheduleSecurityLock();
            }, { passive: true });
        });
        securityActivityBound = true;
    }
    if (isSecurityAppLocked()) {
        securityLocked = false;
        lockSecurityApp();
    } else {
        scheduleSecurityLock();
    }
}

