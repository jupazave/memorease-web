import './styles.css';
import { App } from './ui/app';

const app = new App(document.querySelector<HTMLElement>('#app')!);
void app.init();
