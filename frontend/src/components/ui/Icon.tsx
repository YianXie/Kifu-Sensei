import type { CSSProperties, ComponentType } from "react";

import AccountCircleRounded from "@mui/icons-material/AccountCircleRounded";
import ArrowBackIosRounded from "@mui/icons-material/ArrowBackIosRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowForwardIosRounded from "@mui/icons-material/ArrowForwardIosRounded";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded";
import CodeRounded from "@mui/icons-material/CodeRounded";
import CommentRounded from "@mui/icons-material/CommentRounded";
import ContrastRounded from "@mui/icons-material/ContrastRounded";
import DarkModeRounded from "@mui/icons-material/DarkModeRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import DescriptionRounded from "@mui/icons-material/DescriptionRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import EastRounded from "@mui/icons-material/EastRounded";
import ErrorRounded from "@mui/icons-material/ErrorRounded";
import ExtensionRounded from "@mui/icons-material/ExtensionRounded";
import FastForwardRounded from "@mui/icons-material/FastForwardRounded";
import FastRewindRounded from "@mui/icons-material/FastRewindRounded";
import GridOffRounded from "@mui/icons-material/GridOffRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import InfoRounded from "@mui/icons-material/InfoRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import LightModeRounded from "@mui/icons-material/LightModeRounded";
import LoginRounded from "@mui/icons-material/LoginRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import PolicyRounded from "@mui/icons-material/PolicyRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import SettingsRounded from "@mui/icons-material/SettingsRounded";
import SkipNextRounded from "@mui/icons-material/SkipNextRounded";
import SkipPreviousRounded from "@mui/icons-material/SkipPreviousRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import WarningRounded from "@mui/icons-material/WarningRounded";

/**
 * Material Symbols Rounded glyphs, addressed by ligature name exactly as the
 * design system does — `<Icon name="history" />`.
 *
 * The design serves these from the Material Symbols webfont; here they come from
 * `@mui/icons-material`, which the product already depends on. Same glyph set,
 * but as SVG: no second CDN request, and no flash of raw ligature text ("history")
 * before an icon font arrives. Every name the design uses has an entry; add one
 * here before using a new name.
 */
const GLYPHS = {
    account_circle: AccountCircleRounded,
    arrow_back_ios: ArrowBackIosRounded,
    arrow_downward: ArrowDownwardRounded,
    arrow_forward_ios: ArrowForwardIosRounded,
    auto_awesome: AutoAwesomeRounded,
    check_circle: CheckCircleRounded,
    chevron_left: ChevronLeftRounded,
    chevron_right: ChevronRightRounded,
    close: CloseRounded,
    cloud_upload: CloudUploadRounded,
    code: CodeRounded,
    comment: CommentRounded,
    contrast: ContrastRounded,
    dark_mode: DarkModeRounded,
    delete: DeleteOutlineRounded,
    description: DescriptionRounded,
    download: DownloadRounded,
    east: EastRounded,
    error: ErrorRounded,
    extension: ExtensionRounded,
    fast_forward: FastForwardRounded,
    fast_rewind: FastRewindRounded,
    grid_off: GridOffRounded,
    history: HistoryRounded,
    info: InfoRounded,
    key: KeyRounded,
    light_mode: LightModeRounded,
    login: LoginRounded,
    logout: LogoutRounded,
    menu: MenuRounded,
    open_in_new: OpenInNewRounded,
    policy: PolicyRounded,
    radio_button_unchecked: RadioButtonUncheckedRounded,
    settings: SettingsRounded,
    skip_next: SkipNextRounded,
    skip_previous: SkipPreviousRounded,
    tune: TuneRounded,
    warning: WarningRounded,
} satisfies Record<string, ComponentType<{ className?: string }>>;

export type IconName = keyof typeof GLYPHS;

/** `sm` / `md` / `lg` / `xl` map onto the `--icon-*` tokens; anything else is
 *  passed through as a CSS length. */
export type IconSize = "sm" | "md" | "lg" | "xl" | (string & {});

const SIZES: Record<string, string> = {
    sm: "var(--icon-sm)",
    md: "var(--icon-md)",
    lg: "var(--icon-lg)",
    xl: "var(--icon-xl)",
};

export default function Icon({
    name,
    size,
    className = "",
    style,
}: {
    name: IconName;
    size?: IconSize;
    className?: string;
    style?: CSSProperties;
}) {
    const Glyph = GLYPHS[name];
    return (
        <span
            aria-hidden="true"
            className={`ks-icon ${className}`.trim()}
            style={{
                fontSize: size ? (SIZES[size] ?? size) : undefined,
                ...style,
            }}
        >
            <Glyph />
        </span>
    );
}
