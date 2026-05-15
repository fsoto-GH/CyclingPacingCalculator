import CourseForm from "./components/CourseForm";
import { AmenityProvider } from "./amenityContext";
import { AppSettingsProvider } from "./AppSettingsContext";
import "./App.css";

function App() {
  return (
    <AppSettingsProvider>
      <AmenityProvider>
        <CourseForm />
      </AmenityProvider>
    </AppSettingsProvider>
  );
}

export default App;
