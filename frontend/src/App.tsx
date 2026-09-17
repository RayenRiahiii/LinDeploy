import AppRouter from "./router/AppRouter";
import "./App.css";

type AppProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function App({ colorScheme, onToggleColorScheme }: AppProps) {
  return <AppRouter colorScheme={colorScheme} onToggleColorScheme={onToggleColorScheme} />;
}
