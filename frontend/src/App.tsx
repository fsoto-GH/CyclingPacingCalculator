import CourseForm from "./components/CourseForm";
import { AmenityProvider } from "./amenityContext";
import { AppSettingsProvider } from "./AppSettingsContext";
import "./App.css";

function App() {
  return (
    <AppSettingsProvider>
      <AmenityProvider>
        <div className="app-layout">
          <CourseForm />
          <footer className="app-footer">
            <div className="app-footer-inner">
              <span className="app-footer-name">Cycling Pacing Calculator</span>
              <span className="app-footer-sep" aria-hidden="true">
                ·
              </span>
              <span className="app-footer-copy">
                &copy; {new Date().getFullYear()} — not affiliated with any race
                organization
              </span>
              <span className="app-footer-sep" aria-hidden="true">
                ·
              </span>
              <span className="app-footer-attrib">
                Maps&nbsp;&copy;&nbsp;
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  OpenStreetMap
                </a>{" "}
                contributors
              </span>
              <span className="app-footer-sep" aria-hidden="true">
                ·
              </span>
              <span className="app-footer-attrib">
                Built by{" "}
                <a
                  href="https://fsoto-gh.github.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  fsoto-gh
                </a>
              </span>
              <span className="app-footer-sep" aria-hidden="true">
                ·
              </span>
              <span className="app-footer-help">
                If you&apos;re experiencing problems, try the{" "}
                <a
                  href="https://cyclingpacingcalculator.onrender.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Render.com link
                </a>
                .
              </span>
            </div>
          </footer>
        </div>
      </AmenityProvider>
    </AppSettingsProvider>
  );
}

export default App;
