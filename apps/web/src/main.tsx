import "./styles/app.css";
import { Toasty, TooltipProvider } from "@cloudflare/kumo";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";

const root = document.querySelector("#root");
if (root === null) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <Toasty>
        <SessionProvider>
          <App />
        </SessionProvider>
      </Toasty>
    </TooltipProvider>
  </StrictMode>,
);
