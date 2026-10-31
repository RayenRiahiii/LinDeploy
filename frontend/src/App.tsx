import AppRouter from "./router/AppRouter";
import { AuthProvider } from "./context/AuthContext";
import "./App.css";

type AppProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function App({ colorScheme, onToggleColorScheme }: AppProps) {
  return (
    <AuthProvider>
      <AppRouter colorScheme={colorScheme} onToggleColorScheme={onToggleColorScheme} />
    </AuthProvider>
  );
}
