import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Browse from "./pages/Browse";
import ListingDetail from "./pages/ListingDetail";
import Sold from "./pages/Sold";
import Saved from "./pages/Saved";
import Sources from "./pages/Sources";
import { STATIC_MODE } from "./lib";

// GitHub Pages has no server-side routing, so the static build uses #/ URLs.
const createRouter = STATIC_MODE ? createHashRouter : createBrowserRouter;
const router = createRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "browse", element: <Browse /> },
      { path: "listing/:id", element: <ListingDetail /> },
      { path: "sold", element: <Sold /> },
      { path: "saved", element: <Saved /> },
      { path: "sources", element: <Sources /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
