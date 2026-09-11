{ pkgs ? import <nixpkgs> {} }:
let
in pkgs.mkShell {
  buildInputs = with pkgs; [
    bun
    nodejs_22
  ];
  shellHook = ''
  '';
}
