import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SSEProvider } from "@/hooks/use-sse";
import App from "./App";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <SSEProvider>
          <App />
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "oklch(0.17 0 0)",
                border: "1px solid oklch(0.28 0 0)",
                color: "oklch(0.985 0 0)",
              },
            }}
          />
        </SSEProvider>
      </TooltipProvider>
    </BrowserRouter>
  </React.StrictMode>
);
