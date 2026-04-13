import CourseForm from "./components/CourseForm";
import { AmenityProvider } from "./amenityContext";
import "./App.css";

function App() {
  return (
    <AmenityProvider>
      <div className="app-container">
        <CourseForm />
      </div>
    </AmenityProvider>
  );
}

export default App;
