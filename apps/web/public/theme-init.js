(() => {
  let preference = "system";
  try {
    preference = localStorage.getItem("vault-sync-theme") ?? "system";
  } catch {}
  const dark = preference === "dark" || (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
})();
