// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "../src/TestToken.sol";

contract TestTokenTest is Test {
    TestToken token;
    address owner = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new TestToken(owner);
    }

    function test_metadataMarksItAsTestnetToken() public view {
        assertEq(token.symbol(), "FFUSD");
        assertEq(token.decimals(), 6);
        assertTrue(bytes(token.name()).length > 0);
    }

    function test_ownerCanMint() public {
        vm.prank(owner);
        token.mint(bob, 5e6);
        assertEq(token.balanceOf(bob), 5e6);
        assertEq(token.totalSupply(), 5e6);
    }

    function test_nonOwnerCannotMint() public {
        vm.prank(bob);
        vm.expectRevert();
        token.mint(bob, 1);
    }

    function test_transferMovesBalance() public {
        vm.prank(owner);
        token.mint(bob, 10e6);
        vm.prank(bob);
        token.transfer(address(0xCAFE), 4e6);
        assertEq(token.balanceOf(bob), 6e6);
        assertEq(token.balanceOf(address(0xCAFE)), 4e6);
    }

    function test_transferMoreThanBalanceReverts() public {
        vm.prank(bob);
        vm.expectRevert();
        token.transfer(address(0xCAFE), 1);
    }

    function test_ownershipTransferIsOwnerOnly() public {
        vm.prank(bob);
        vm.expectRevert();
        token.transferOwnership(bob);
        vm.prank(owner);
        token.transferOwnership(bob);
        assertEq(token.owner(), bob);
    }
}
