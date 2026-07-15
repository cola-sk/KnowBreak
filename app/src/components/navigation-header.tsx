"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavigationHeader() {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isTasks = pathname?.startsWith("/tasks");
  const isProjects = pathname?.startsWith("/projects");
  const isWorkflows = pathname?.startsWith("/workflows");
  const isSettings = pathname?.startsWith("/settings");

  return (
    <header className="global-header">
      <div className="header-container">
        <Link href="/" className="header-logo">
          <img src="/static/logo-nav.svg" alt="KnowBreak" className="logo-icon-img" />
          <span className="logo-text">
            KnowBreak <span className="logo-subtext">Review</span>
          </span>
        </Link>
        <nav className="header-nav">
          <Link href="/" className={`nav-link ${isHome ? "active" : ""}`}>
            新建流程
          </Link>
          <Link href="/projects" className={`nav-link ${isProjects ? "active" : ""}`}>
            项目列表
          </Link>
          <Link href="/tasks" className={`nav-link ${isTasks ? "active" : ""}`}>
            任务中心
          </Link>
          <Link href="/workflows" className={`nav-link ${isWorkflows ? "active" : ""}`}>
            工作流配置
          </Link>
          <Link href="/settings" className={`nav-link ${isSettings ? "active" : ""}`}>
            全局设置
          </Link>
        </nav>
      </div>
    </header>
  );
}
