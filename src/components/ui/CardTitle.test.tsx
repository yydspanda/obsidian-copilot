import React from "react";
import { render, screen } from "@testing-library/react";
import { CardTitle } from "@/components/ui/CardTitle";

describe("CardTitle", () => {
  describe("CardTitle()", () => {
    it("renders its content and forwards attributes, classes, and the element ref", () => {
      const ref: React.RefObject<HTMLDivElement> = { current: null };
      render(
        <CardTitle ref={ref} className="tw-text-muted" title="Status">
          Ready
        </CardTitle>
      );
      expect(screen.getByText("Ready")).toBe(ref.current);
      expect(ref.current?.title).toBe("Status");
      expect(ref.current?.classList.contains("tw-text-muted")).toBe(true);
    });
  });
});
