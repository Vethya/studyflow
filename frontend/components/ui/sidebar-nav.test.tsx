// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarContext } from "./sidebar";
import { SidebarNav } from "./sidebar-nav";

const state = vi.hoisted(() => ({ pathname: "/dashboard" }));
type OpenMobileMock = (open: boolean) => void;
type VoidMock = () => void;

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

const Icon = () => <svg aria-hidden="true" />;

function renderNav({
  isMobile,
  setOpenMobile,
  onClick,
  collapsed = false,
}: {
  isMobile: boolean;
  setOpenMobile: OpenMobileMock;
  onClick?: VoidMock;
  collapsed?: boolean;
}) {
  return render(
    <SidebarContext.Provider
      value={{
        state: collapsed ? "collapsed" : "expanded",
        open: !collapsed,
        setOpen: vi.fn<OpenMobileMock>(),
        openMobile: true,
        setOpenMobile,
        isMobile,
        toggleSidebar: vi.fn<VoidMock>(),
      }}
    >
      <SidebarNav
        items={
          onClick
            ? [{ title: "Settings tab", icon: Icon, onClick }]
            : [{ title: "Tasks", icon: Icon, url: "/tasks" }]
        }
      />
    </SidebarContext.Provider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SidebarNav mobile navigation", () => {
  it("closes the mobile sidebar when a route link is selected", () => {
    const setOpenMobile = vi.fn<OpenMobileMock>();
    renderNav({ isMobile: true, setOpenMobile });

    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));

    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });

  it("does not close the desktop sidebar for route links", () => {
    const setOpenMobile = vi.fn<OpenMobileMock>();
    renderNav({ isMobile: false, setOpenMobile });

    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));

    expect(setOpenMobile).not.toHaveBeenCalled();
  });

  it("does not close the mobile sidebar for button-based navigation", () => {
    const setOpenMobile = vi.fn<OpenMobileMock>();
    const onClick = vi.fn<VoidMock>();
    renderNav({ isMobile: true, setOpenMobile, onClick });

    fireEvent.click(screen.getByRole("button", { name: "Settings tab" }));

    expect(onClick).toHaveBeenCalled();
    expect(setOpenMobile).not.toHaveBeenCalled();
  });

  it("names icon-only route links when the desktop sidebar is collapsed", () => {
    renderNav({ isMobile: false, setOpenMobile: vi.fn<OpenMobileMock>(), collapsed: true });

    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-label")).toBe("Tasks");
  });
});
