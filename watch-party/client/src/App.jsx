import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Room from "./pages/Room.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:code" element={<Room />} />
    </Routes>
  );
}
