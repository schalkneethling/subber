const appShell = document.querySelector<HTMLElement>("[data-app-shell]");

if (!appShell) {
  throw new Error("The application shell could not be found.");
}

appShell.dataset.state = "ready";
