import { Link } from "react-router";

export default function Footer() {
    return (
        <footer className="ks-footer">
            <span>© {new Date().getFullYear()} Kifu-Sensei</span>
            <div className="ks-footer__links">
                <Link to="/privacy">Privacy policy</Link>
                <a
                    href="https://github.com/YianXie/Kifu-Sensei"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
            </div>
        </footer>
    );
}
