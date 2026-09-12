// static/js/theme.js
// Gerenciador Central de Tema Claro / Escuro (Dark Mode)

document.addEventListener("DOMContentLoaded", () => {
    const themeToggleBtn = document.getElementById("themeToggle");
    const themeToggleIcon = document.getElementById("themeToggleIcon");

    function atualizarLayoutTema() {
        if (!themeToggleIcon) return;
        if (document.documentElement.classList.contains("dark")) {
            themeToggleIcon.textContent = "☀️";
        } else {
            themeToggleIcon.textContent = "🌙";
        }
    }

    if (themeToggleBtn && themeToggleIcon) {
        atualizarLayoutTema();
        themeToggleBtn.addEventListener("click", () => {
            if (document.documentElement.classList.contains("dark")) {
                document.documentElement.classList.remove("dark");
                localStorage.setItem("theme", "light");
            } else {
                document.documentElement.classList.add("dark");
                localStorage.setItem("theme", "dark");
            }
            atualizarLayoutTema();
        });
    }
});