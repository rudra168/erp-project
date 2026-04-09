// =============================
// ERP AUTH SYSTEM
// =============================

function getLoggedInUser() {
  return JSON.parse(localStorage.getItem("erpLoggedInUser"));
}

// Login check
function requireLogin() {
  const user = getLoggedInUser();

  if (!user) {
    alert("Login required ❌");
    window.location.href = "login.html";
  }
}

// Role check
function requireRole(allowedRoles = []) {
  const user = getLoggedInUser();

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!allowedRoles.includes(user.role)) {
    alert("Access Denied ❌");
    window.location.href = "dashboard.html";
  }
}