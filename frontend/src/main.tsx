import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import App from "./App";
import Product from "./pages/Product";
import NotFound from "./pages/NotFound";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <BrowserRouter>
        <Routes>
          {/* Public product/pricing page is the landing page so payment-gateway
              reviewers see the store without logging in. /product kept as an
              alias because that link may already be circulating in the review. */}
          <Route path="/" element={<Product />} />
          <Route path="/product" element={<Product />} />
          <Route path="/app" element={<App />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
